import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Hand3D } from '../../../../../lib/hand3d';
import { TICK_MS } from '../../../../../lib/motion';
import { lerpPose, type SignToken } from '../../../../../lib/signs';
import type { SignSource } from '../../../../../lib/signData';
import { drawSkeleton, type Bounds } from '../../../../../lib/skeleton';
import { DEFAULT_SKIN, SKIN_TONES, skinColor } from '../../../../../lib/skinTones';
import { loadPref, savePref } from '../../../../core/utils/platform';
import { Icon } from '../../../../shared/components/icon/icon';

/** Cómo se dibuja la mano. */
type HandStyle = '3d' | 'skeleton';

export interface MediaInfo {
  type: 'image' | 'video';
  url: string;
}

/** Cómo se anima una seña grabada. */
export type SignAnimation = {
  /** De dónde salió: grabada por el usuario o del paquete oficial. */
  source: SignSource;
  /** false = seña del paquete oficial que aún no revisa una persona que sepa LSM. */
  reviewed: boolean;
} & (
  | { kind: 'static'; pose: number[] }
  | { kind: 'dynamic'; frames: number[][]; bounds: Bounds }
);

// Duración de cada paso a velocidad normal (milisegundos)
const LETTER_MS = 1100;
const WORD_MS = 1700;
const SPACE_MS = 500;
const TRANSITION_MS = 350; // tiempo que tarda la mano en pasar de una seña a otra
const DYNAMIC_END_MS = 500; // pausa al final de una seña con movimiento

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

/** Nombre de la seña de un paso (o null si no tiene). */
function labelOf(token: SignToken | undefined): string | null {
  return token && (token.kind === 'letter' || token.kind === 'word') ? token.label : null;
}

/** Texto que se muestra para un paso. */
function textOf(token: SignToken | undefined): string {
  if (!token) return '';
  if (token.kind === 'letter') return token.label;
  if (token.kind === 'word' || token.kind === 'other') return token.text;
  return '';
}

/** Suavizado de la animación (empieza y termina despacio). */
const ease = (t: number) => t * t * (3 - 2 * t);
const firstPose = (a: SignAnimation) => (a.kind === 'static' ? a.pose : a.frames[0]);
const lastPose = (a: SignAnimation) => (a.kind === 'static' ? a.pose : a.frames[a.frames.length - 1]);

/** Pose de una seña con movimiento en un momento dado (mezclando cuadros vecinos para que sea fluido). */
function poseAt(frames: number[][], ms: number): number[] {
  const pos = Math.max(0, ms / TICK_MS);
  const i = Math.min(frames.length - 1, Math.floor(pos));
  const j = Math.min(frames.length - 1, i + 1);
  return lerpPose(frames[i], frames[j], Math.min(1, pos - i));
}

// Reproduce una lista de señas con la mano animada (3D o esqueleto) o con fotos/videos propios.
@Component({
  selector: 'app-sign-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './sign-player.html',
  styleUrl: './sign-player.css',
})
export class SignPlayer {
  readonly tokens = input.required<SignToken[]>();
  readonly animations = input.required<Map<string, SignAnimation>>();
  readonly packageVersion = input<number | null>(null);
  readonly media = input.required<Map<string, MediaInfo>>();
  readonly useMedia = input(true);
  /** Avisa qué seña se está mostrando (para poder asociarle una foto o video). */
  readonly currentChange = output<SignToken | null>();

  protected readonly speeds = SPEEDS;
  protected readonly skinTones = SKIN_TONES;
  protected readonly textOf = textOf;

  protected readonly index = signal(0);
  protected readonly playing = signal(true);
  protected readonly speed = signal(1);
  protected readonly mirror = signal(true);
  protected readonly style = signal<HandStyle>(loadPref('handStyle', '3d') === 'skeleton' ? 'skeleton' : '3d');
  protected readonly skin = signal(loadPref('skinTone', DEFAULT_SKIN));
  protected readonly rotated = signal(false);
  protected readonly error3d = signal('');
  protected readonly use3d = computed(() => this.style() === '3d' && !this.error3d());

  private readonly canvas2d = viewChild<ElementRef<HTMLCanvasElement>>('c2d');
  private readonly canvas3d = viewChild<ElementRef<HTMLCanvasElement>>('c3d');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('vid');
  protected hand: Hand3D | null = null;

  // Estado de la animación fuera de los signals, para no redibujar la página 60 veces por segundo
  private anim = { index: 0, elapsed: 0, playing: true };

  protected readonly token = computed(() => this.tokens()[this.index()]);
  protected readonly caption = computed(() => textOf(this.token()));

  protected readonly currentMedia = computed(() => this.mediaFor(this.token()));

  protected readonly origin = computed(() => {
    if (this.currentMedia()) return { text: 'Tu foto o video', warn: false };
    const label = labelOf(this.token());
    const a = label ? this.animations().get(label) : undefined;
    if (!a) return null;
    if (a.source === 'personal') return { text: 'Grabada por ti', warn: false };
    const v = this.packageVersion();
    return a.reviewed
      ? { text: `Paquete oficial${v ? ` v${v}` : ''}`, warn: false }
      : { text: `Paquete v${v ?? '?'} · sin revisar`, warn: true };
  });

  /** Mensaje honesto cuando no hay seña grabada. */
  protected readonly missing = computed(() => {
    const t = this.token();
    if (t?.kind === 'other') return 'Este carácter no tiene seña en el alfabeto.';
    const label = labelOf(t);
    if (label && !this.animations().has(label) && !this.currentMedia()) {
      return 'No tengo esta seña grabada. Puedes grabarla en Cámara › Entrenar.';
    }
    return null;
  });

  constructor() {
    // Al cambiar el texto, empezamos desde el principio
    effect(() => {
      const n = this.tokens().length;
      untracked(() => {
        this.anim = { index: 0, elapsed: 0, playing: n > 0 };
        this.index.set(0);
        this.playing.set(n > 0);
      });
    });

    effect(() => this.currentChange.emit(this.token() ?? null));

    // Crear la mano 3D cuando aparece su lienzo. three.js se descarga solo cuando hace falta.
    effect((onCleanup) => {
      const el = this.canvas3d()?.nativeElement;
      if (!el) return;
      let cancelled = false;
      let hand: Hand3D | null = null;
      import('../../../../../lib/hand3d')
        .then(({ Hand3D }) => {
          if (cancelled) return;
          hand = new Hand3D(el, skinColor(untracked(this.skin)));
          hand.onRotatedChange = (r) => this.rotated.set(r);
          this.hand = hand;
        })
        .catch((err) => {
          console.error(err);
          if (!cancelled) this.error3d.set('Este dispositivo no puede mostrar la mano 3D. Se muestra el esqueleto.');
        });
      onCleanup(() => {
        cancelled = true;
        this.hand = null;
        hand?.dispose();
        this.rotated.set(false);
      });
    });

    // Cambiar el tono de piel
    effect(() => {
      const s = this.skin();
      this.hand?.setSkin(skinColor(s));
    });

    // Videos: pausar/reanudar con el botón y ajustar velocidad
    effect(() => {
      const v = this.video()?.nativeElement;
      const playing = this.playing();
      const speed = this.speed();
      this.index();
      if (!v) return;
      v.playbackRate = speed;
      if (playing) v.play().catch(() => {});
      else v.pause();
    });

    // Bucle de animación
    let raf = 0;
    afterNextRender(() => {
      let last = performance.now();
      const frame = (now: number) => {
        const dt = now - last;
        last = now;
        this.tick(dt);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(raf));
  }

  private mediaFor(token: SignToken | undefined) {
    const label = labelOf(token);
    return this.useMedia() && label ? this.media().get(label) : undefined;
  }

  protected hasSign(t: SignToken) {
    const l = labelOf(t);
    return l ? this.animations().has(l) || Boolean(this.useMedia() && this.media().get(l)) : false;
  }

  /** Cuánto dura un paso. Los videos duran lo que dure el video. */
  private durationOf(token: SignToken | undefined): number {
    if (!token) return 0;
    if (this.mediaFor(token)?.type === 'video') return Infinity; // avanza al terminar el video
    if (token.kind === 'space') return SPACE_MS;
    const animation = this.animations().get(labelOf(token) ?? '');
    if (animation?.kind === 'dynamic') return TRANSITION_MS + animation.frames.length * TICK_MS + DYNAMIC_END_MS;
    if (token.kind === 'word') return WORD_MS;
    return LETTER_MS;
  }

  private tick(dt: number) {
    const a = this.anim;
    const tokens = this.tokens();
    const animations = this.animations();

    // Avanzar el tiempo
    if (a.playing && tokens.length) {
      a.elapsed += dt * this.speed();
      if (a.elapsed >= this.durationOf(tokens[a.index])) {
        if (a.index < tokens.length - 1) {
          a.index++;
          a.elapsed = 0;
          this.index.set(a.index);
        } else {
          a.playing = false; // terminó
          this.playing.set(false);
        }
      }
    }

    // ¿Qué pose toca mostrar ahora?
    let pose: number[] | null = null;
    let bounds: Bounds | undefined;
    const animation = animations.get(labelOf(tokens[a.index]) ?? '');
    if (animation) {
      bounds = animation.kind === 'dynamic' ? animation.bounds : undefined;
      if (a.elapsed < TRANSITION_MS) {
        // Transición desde la seña anterior (saltando espacios)
        let prev: number[] | undefined;
        for (let i = a.index - 1; i >= 0; i--) {
          if (tokens[i].kind === 'space') continue;
          const prevAnim = animations.get(labelOf(tokens[i]) ?? '');
          if (prevAnim) prev = lastPose(prevAnim);
          break;
        }
        const start = firstPose(animation);
        const t = ease(a.elapsed / TRANSITION_MS);
        pose = prev ? lerpPose(prev, start, t) : start;
      } else if (animation.kind === 'dynamic') {
        pose = poseAt(animation.frames, a.elapsed - TRANSITION_MS);
      } else {
        pose = animation.pose;
      }
    }

    // Dibujar: mano 3D o esqueleto 2D
    if (this.hand) {
      this.hand.render(pose, this.mirror(), bounds);
      return;
    }
    const canvas = this.canvas2d()?.nativeElement;
    if (!canvas) return;
    // Ajustar la resolución del lienzo a su tamaño en pantalla
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (pose) drawSkeleton(ctx, pose, this.mirror(), bounds);
  }

  // ---------- Controles ----------

  /** Salta a un paso concreto. */
  protected goTo(i: number, play = this.anim.playing) {
    const clamped = Math.max(0, Math.min(this.tokens().length - 1, i));
    // En pausa nos saltamos la transición: si no, se quedaría mostrando la seña anterior
    this.anim = { index: clamped, elapsed: play ? 0 : TRANSITION_MS, playing: play };
    this.index.set(clamped);
    this.playing.set(play);
    const v = this.video()?.nativeElement;
    if (v) v.currentTime = 0;
  }

  /** Siguiente/anterior seña, saltando los espacios. */
  protected step(dir: 1 | -1) {
    const tokens = this.tokens();
    let i = this.anim.index + dir;
    while (tokens[i]?.kind === 'space') i += dir;
    if (i >= 0 && i < tokens.length) this.goTo(i);
  }

  protected togglePlay() {
    const a = this.anim;
    const tokens = this.tokens();
    const atEnd = !a.playing && a.index === tokens.length - 1 && a.elapsed >= this.durationOf(tokens[a.index]);
    if (atEnd) this.goTo(0, true);
    else {
      a.playing = !a.playing;
      this.playing.set(a.playing);
    }
  }

  protected onVideoEnded() {
    if (!this.anim.playing) return;
    if (this.anim.index < this.tokens().length - 1) this.step(1);
    else {
      this.anim.playing = false;
      this.playing.set(false);
    }
  }

  protected setStyle(value: HandStyle) {
    this.style.set(value);
    savePref('handStyle', value);
  }

  protected setSkin(id: string) {
    this.skin.set(id);
    savePref('skinTone', id);
  }
}
