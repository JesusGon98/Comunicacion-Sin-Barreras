import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../../../../shared/components/icon/icon';

const MAX_VIDEO_SECONDS = 8;

/** Elige un formato de video que el navegador sepa grabar. */
function pickVideoType(): string {
  const options = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  return options.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

// Ventana para tomar una foto o grabar un video corto de una seña con la cámara.
@Component({
  selector: 'app-capture-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './capture-dialog.html',
  styleUrl: './capture-dialog.css',
})
export class CaptureDialog {
  readonly label = input.required<string>();
  readonly captured = output<Blob>();
  readonly close = output<void>();

  protected readonly maxSeconds = MAX_VIDEO_SECONDS;
  protected readonly canRecord = typeof MediaRecorder !== 'undefined';
  protected readonly error = signal('');
  protected readonly recording = signal(false);
  protected readonly seconds = signal(0);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  protected recorder: MediaRecorder | null = null;
  private timer = 0;

  constructor() {
    let cancelled = false;
    // Encender la cámara al abrir; apagarla al cerrar
    afterNextRender(() => {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .then(async (stream) => {
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          this.stream = stream;
          const v = this.videoRef()!.nativeElement;
          v.srcObject = stream;
          await v.play();
        })
        .catch(() => this.error.set('No se pudo abrir la cámara. Revisa el permiso en el navegador.'));
    });
    inject(DestroyRef).onDestroy(() => {
      cancelled = true;
      clearInterval(this.timer);
      if (this.recorder?.state === 'recording') this.recorder.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
    });
  }

  protected takePhoto() {
    const video = this.videoRef()?.nativeElement;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && this.captured.emit(blob), 'image/jpeg', 0.85);
  }

  protected startVideo() {
    if (!this.stream) return;
    const type = pickVideoType();
    const recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearInterval(this.timer);
      this.recording.set(false);
      if (chunks.length) this.captured.emit(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    };
    this.recorder = recorder;
    recorder.start();
    this.seconds.set(0);
    this.recording.set(true);
    // Contador de segundos (y corte automático)
    this.timer = window.setInterval(() => {
      this.seconds.update((s) => s + 1);
      if (this.seconds() >= MAX_VIDEO_SECONDS) recorder.stop();
    }, 1000);
  }
}
