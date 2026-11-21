import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { detectHand, drawHand, getHandLandmarker, type HandFrame } from '../../lib/hands';
import { handGeometry, normalizeHand } from '../../lib/normalize';
import { Icon } from '../shared/icon';

type Status = 'off' | 'loading' | 'running' | 'error';

/** Caja compartida: la cámara escribe la mano detectada en cada cuadro y los paneles la leen. */
export interface FrameBox {
  current: HandFrame | null;
}

/** Mensajes de error en lenguaje sencillo. */
function errorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (!window.isSecureContext) return 'La cámara solo funciona en una dirección segura (https) o en localhost.';
  if (name === 'NotAllowedError') {
    return 'No hay permiso para usar la cámara. Actívalo en la configuración del navegador (el candado junto a la dirección).';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ninguna cámara.';
  if (name === 'NotReadableError') return 'La cámara está ocupada por otra aplicación. Ciérrala e intenta de nuevo.';
  return 'No se pudo iniciar la detección de manos. Recarga la página e intenta de nuevo.';
}

// Muestra la cámara con los puntos de la mano dibujados encima.
// Lo que se proyecta dentro (<ng-content>) aparece encima del video, abajo.
@Component({
  selector: 'app-camera-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="camera">
      <div class="camera__mirror" [class.camera__mirror--on]="facing() === 'user'">
        <video #video class="camera__video" playsinline muted></video>
        <canvas #canvas class="camera__canvas"></canvas>
      </div>

      @switch (status()) {
        @case ('off') {
          <!-- Cámara apagada: todo el recuadro es un botón grande para encenderla -->
          <button type="button" class="camera__start" (click)="toggle.emit()">
            <span class="camera__start-icon"><app-icon name="camera" [size]="38" /></span>
            Encender cámara
            <small>Las imágenes nunca salen de tu dispositivo.</small>
          </button>
        }
        @case ('loading') {
          <div class="camera__message">
            <span class="spinner" aria-hidden="true"></span>
            <p>Preparando la cámara y el detector de manos…<br /><small>La primera vez tarda unos segundos.</small></p>
          </div>
        }
        @case ('error') {
          <div class="camera__message">
            <p>{{ error() }}</p>
            <button type="button" class="btn btn--outline" style="color: #fff" (click)="toggle.emit()">Cerrar</button>
          </div>
        }
      }

      <div class="camera__overlay"><ng-content /></div>

      <!-- Controles encima del video: indicador de mano, cambiar cámara y apagar -->
      @if (status() === 'running' || status() === 'loading') {
        <div class="camera__top">
          @if (status() === 'running') {
            <span class="hand-indicator" [class.hand-indicator--on]="handVisible()" role="status">
              {{ handVisible() ? 'Mano detectada' : 'Sin mano' }}
            </span>
          } @else {
            <span></span>
          }
          <div class="camera__buttons">
            @if (status() === 'running' && cameraCount() > 1) {
              <button
                type="button"
                class="icon-btn icon-btn--glass"
                (click)="facing.set(facing() === 'user' ? 'environment' : 'user')"
                aria-label="Cambiar cámara"
                title="Cambiar cámara"
              >
                <app-icon name="switch-camera" />
              </button>
            }
            <button
              type="button"
              class="icon-btn icon-btn--glass"
              (click)="toggle.emit()"
              aria-label="Apagar cámara"
              title="Apagar cámara"
            >
              <app-icon name="power" />
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CameraView {
  /** Si es true, la cámara está encendida. */
  readonly active = input.required<boolean>();
  readonly frame = input.required<FrameBox>();
  /** Encender o apagar la cámara. */
  readonly toggle = output<void>();

  protected readonly status = signal<Status>('off');
  protected readonly error = signal('');
  protected readonly handVisible = signal(false);
  /** 'user' = cámara frontal (selfie), 'environment' = cámara trasera. */
  protected readonly facing = signal<'user' | 'environment'>('user');
  protected readonly cameraCount = signal(0);

  private readonly videoRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    effect((onCleanup) => {
      const active = this.active();
      const facing = this.facing();
      const box = this.frame();
      if (!active) {
        this.status.set('off');
        return;
      }
      let cancelled = false;
      let stream: MediaStream | null = null;
      let raf = 0;
      untracked(() => this.start(facing, box, () => cancelled, (s) => (stream = s), (r) => (raf = r)));

      // Al apagar: detener el bucle y la cámara
      onCleanup(() => {
        cancelled = true;
        cancelAnimationFrame(raf);
        (stream as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        box.current = null;
        this.handVisible.set(false);
      });
    });
  }

  private async start(
    facing: 'user' | 'environment',
    box: FrameBox,
    isCancelled: () => boolean,
    setStream: (s: MediaStream) => void,
    setRaf: (id: number) => void,
  ) {
    try {
      this.status.set('loading');
      this.error.set('');
      const landmarker = await getHandLandmarker();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(stream);
      if (isCancelled()) return stream.getTracks().forEach((t) => t.stop());

      const video = this.videoRef().nativeElement;
      video.srcObject = stream;
      await video.play();
      if (isCancelled()) return;

      // ¿Cuántas cámaras hay? (para mostrar el botón "Cambiar cámara")
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameraCount.set(devices.filter((d) => d.kind === 'videoinput').length);
      this.status.set('running');

      // Bucle: en cada cuadro nuevo del video, detectamos la mano
      let lastVideoTime = -1;
      const loop = () => {
        if (isCancelled()) return;
        const canvas = this.canvasRef().nativeElement;
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const ctx = canvas.getContext('2d')!;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const hand = detectHand(landmarker, video, performance.now());
          const aspect = video.videoWidth / video.videoHeight;
          const isLeft = hand?.handedness === 'Left';
          const vector = hand ? normalizeHand(hand.landmarks, isLeft, aspect) : null;

          if (hand && vector) {
            drawHand(ctx, hand.landmarks);
            const { wrist, size } = handGeometry(hand.landmarks, isLeft, aspect);
            box.current = { vector, handedness: hand.handedness, wrist, size, time: performance.now() };
          } else {
            box.current = null;
          }
          // El signal solo avisa cuando cambia, así que no redibuja la página en cada cuadro
          this.handVisible.set(Boolean(hand && vector));
        }
        setRaf(requestAnimationFrame(loop));
      };
      loop();
    } catch (err) {
      if (isCancelled()) return;
      console.error(err);
      this.error.set(errorMessage(err));
      this.status.set('error');
    }
  }
}
