import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { currentLanguage } from '../../../../../config/language';
import {
  addSignSample,
  deleteSign,
  getOfficialPackageInfo,
  getSignSamples,
  type OfficialPackageInfo,
} from '../../../../../lib/db';
import type { HandFrame } from '../../../../../lib/hands';
import { TICK_MS, toSequence, trimStill } from '../../../../../lib/motion';
import { ensureBundledPackage } from '../../../../../lib/officialPackage';
import { onSignsChanged } from '../../../../../lib/signData';
import { vibrate } from '../../../../../lib/speech';
import { Icon } from '../../../../shared/components/icon/icon';
import type { FrameBox } from '../camera-view/camera-view';
import { SharePanel } from '../share-panel/share-panel';

const MIN_RECOMMENDED = 10; // ejemplos mínimos recomendados por seña
const CAPTURE_INTERVAL_MS = 250; // señas quietas: tiempo entre un ejemplo y otro
const COUNTDOWN_SECONDS = 3;
const BETWEEN_SECONDS = 2; // señas con movimiento: pausa entre repeticiones

type Phase =
  | { kind: 'idle' }
  | { kind: 'countdown'; seconds: number; next: number }
  | { kind: 'recording'; done: number }
  | { kind: 'moving'; done: number };

interface SignInfo {
  count: number;
  dynamic: boolean;
}

/** Limpia el nombre de la seña: las letras del alfabeto van en mayúscula. */
function cleanLabel(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  const upper = text.toUpperCase();
  return currentLanguage.alphabet.includes(upper) ? upper : text.toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Modo entrenar: el usuario hace una seña frente a la cámara y se graban varios ejemplos.
@Component({
  selector: 'app-train-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, SharePanel],
  templateUrl: './train-panel.html',
  styleUrl: './train-panel.css',
})
export class TrainPanel {
  readonly frame = input.required<FrameBox>();
  readonly cameraOn = input.required<boolean>();

  readonly overlayTpl = viewChild<TemplateRef<unknown>>('overlay');
  readonly footerTpl = viewChild<TemplateRef<unknown>>('footer');

  private readonly lang = currentLanguage.id;
  protected readonly alphabet = currentLanguage.alphabet;
  protected readonly dynamicLetters = currentLanguage.dynamicLetters;
  protected readonly minRecommended = MIN_RECOMMENDED;
  protected readonly durations = [1.5, 2, 3];

  protected readonly label = signal('');
  protected readonly wordMotion = signal(false); // la palabra escrita lleva movimiento
  protected readonly target = signal(MIN_RECOMMENDED);
  protected readonly seconds = signal(2); // duración de cada repetición con movimiento
  protected readonly signs = signal<Map<string, SignInfo>>(new Map());
  protected readonly phase = signal<Phase>({ kind: 'idle' });
  protected readonly warning = signal('');
  protected readonly packageInfo = signal<OfficialPackageInfo | null>(null);
  private cancelled = false;

  protected readonly name = computed(() => cleanLabel(this.label()));
  protected readonly isLetter = computed(() => currentLanguage.alphabet.includes(this.name()));
  /** Las letras con movimiento siempre se graban con movimiento; las otras letras, quietas. */
  protected readonly withMotion = computed(() =>
    this.isLetter() ? currentLanguage.dynamicLetters.includes(this.name()) : this.wordMotion(),
  );
  protected readonly busy = computed(() => this.phase().kind !== 'idle');
  protected readonly targets = computed(() => (this.withMotion() ? [5, 10, 15] : [10, 20, 30]));
  /** Cantidad a grabar (si la elegida no aplica a este tipo de seña, usamos la recomendada). */
  protected readonly count = computed(() =>
    this.targets().includes(this.target()) ? this.target() : this.targets()[1],
  );
  protected readonly progress = computed(() => {
    const p = this.phase();
    return p.kind === 'recording' || p.kind === 'moving' ? p.done : 0;
  });
  protected readonly countdownSeconds = computed(() => {
    const p = this.phase();
    return p.kind === 'countdown' ? p.seconds : 0;
  });
  protected readonly countdownNext = computed(() => {
    const p = this.phase();
    return p.kind === 'countdown' ? p.next : 0;
  });
  protected readonly trained = computed(() =>
    [...this.signs().entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')),
  );

  constructor() {
    this.refreshCounts();
    const loadPackage = () =>
      ensureBundledPackage(currentLanguage).then(() =>
        getOfficialPackageInfo(this.lang).then((p) => this.packageInfo.set(p)),
      );
    loadPackage();
    const stop = onSignsChanged(loadPackage);
    inject(DestroyRef).onDestroy(() => {
      this.cancelled = true; // si se sale de la pantalla, se detiene la grabación
      stop();
    });
  }

  async refreshCounts() {
    const samples = await getSignSamples(this.lang);
    const map = new Map<string, SignInfo>();
    for (const s of samples) {
      const info = map.get(s.label) ?? { count: 0, dynamic: false };
      map.set(s.label, { count: info.count + 1, dynamic: info.dynamic || s.kind === 'dynamic' });
    }
    this.signs.set(map);
  }

  protected cancel() {
    this.cancelled = true;
  }

  /** Cuenta regresiva visible, con vibración. Devuelve false si se canceló. */
  private async countdown(secs: number, next: number) {
    for (let s = secs; s > 0; s--) {
      this.phase.set({ kind: 'countdown', seconds: s, next });
      vibrate(50);
      await sleep(1000);
      if (this.cancelled) return false;
    }
    return true;
  }

  /** Seña quieta: graba "count" fotos de la mano, una cada 250 ms. */
  private async recordStatic(name: string, count: number) {
    let done = 0;
    let lastTime = 0;
    this.phase.set({ kind: 'recording', done });
    while (done < count && !this.cancelled) {
      await sleep(CAPTURE_INTERVAL_MS);
      const frame = this.frame().current;
      // Solo guardamos si hay una mano y es un cuadro nuevo
      if (!frame || frame.time === lastTime) {
        this.warning.set('No veo tu mano. Ponla frente a la cámara.');
        continue;
      }
      this.warning.set('');
      lastTime = frame.time;
      await addSignSample({ lang: this.lang, label: name, kind: 'static', points: frame.vector, createdAt: Date.now() });
      done++;
      this.phase.set({ kind: 'recording', done });
    }
  }

  /** Seña con movimiento: graba "count" repeticiones de unos segundos cada una. */
  private async recordDynamic(name: string, count: number) {
    const seconds = this.seconds();
    let done = 0;
    let attempts = 0;
    while (done < count && attempts < count * 2 && !this.cancelled) {
      attempts++;
      if (attempts > 1 && !(await this.countdown(BETWEEN_SECONDS, done + 1))) return;
      this.phase.set({ kind: 'moving', done });
      vibrate(120); // ¡ahora!

      // Tomamos un cuadro cada TICK_MS durante los segundos elegidos
      const frames: HandFrame[] = [];
      const start = performance.now();
      let lastTime = 0;
      while (performance.now() - start < seconds * 1000 && !this.cancelled) {
        await sleep(TICK_MS);
        const f = this.frame().current;
        if (f && f.time !== lastTime) {
          frames.push(f);
          lastTime = f.time;
        }
      }
      if (this.cancelled) return;

      // Quitamos la parte quieta del principio y del final
      const moving = frames.length > 5 ? trimStill(frames) : null;
      if (!moving || moving.length < 5) {
        this.warning.set(
          frames.length < 5
            ? 'No vi tu mano durante la grabación. Repitamos.'
            : 'No detecté movimiento. Haz la seña completa cuando diga «¡Ahora!».',
        );
        vibrate([100, 60, 100]);
        continue;
      }
      this.warning.set('');
      await addSignSample({
        lang: this.lang,
        label: name,
        kind: 'dynamic',
        points: moving[Math.floor(moving.length / 2)].vector,
        frames: toSequence(moving),
        createdAt: Date.now(),
      });
      done++;
      this.phase.set({ kind: 'moving', done });
    }
  }

  protected async record() {
    const name = this.name();
    if (!name) return;
    const count = this.count();
    const withMotion = this.withMotion();
    this.cancelled = false;
    this.warning.set('');
    if (await this.countdown(COUNTDOWN_SECONDS, 1)) {
      if (withMotion) await this.recordDynamic(name, count);
      else await this.recordStatic(name, count);
    }
    this.warning.set('');
    this.phase.set({ kind: 'idle' });
    vibrate([80, 60, 80]); // aviso de que terminó
    this.refreshCounts();
  }

  protected async remove(signLabel: string) {
    if (!window.confirm(`¿Borrar todos los ejemplos de «${signLabel}»?`)) return;
    await deleteSign(this.lang, signLabel);
    this.refreshCounts();
  }
}
