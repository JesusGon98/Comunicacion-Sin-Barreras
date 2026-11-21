import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { currentLanguage } from '../../config/language';
import { DtwClassifier, KnnClassifier } from '../../lib/classifier';
import { addHistory, type OfficialPackageInfo } from '../../lib/db';
import type { HandFrame } from '../../lib/hands';
import { MOVING_ENERGY, STILL_ENERGY, TICK_MS, motionEnergy, toSequence, trimStill } from '../../lib/motion';
import { loadAllSamples, onSignsChanged } from '../../lib/signData';
import { isSynthesisSupported, speak, vibrate } from '../../lib/speech';
import { Icon } from '../shared/icon';
import { ShowOverlay } from '../shared/show-overlay';
import type { FrameBox } from './camera-view';

const STABLE_FRAMES = 5; // la seña quieta debe repetirse ~0.3 s para mostrarla
const HOLD_FRAMES = 15; // y sostenerse ~1 s para agregarla al texto
const STILL_FRAMES_TO_END = 4; // ~0.25 s quieta = terminó el movimiento
const MAX_SEGMENT_FRAMES = 75; // un movimiento dura como máximo ~5 s
const SHOW_DYNAMIC_MS = 1200; // tiempo que se muestra una seña con movimiento reconocida

interface Reading {
  state: 'no-hand' | 'unsure' | 'sure' | 'moving';
  label: string;
  confidence: number;
}

// Modo reconocer: compara la mano de la cámara con las señas entrenadas.
//  - Señas quietas → k-NN, cuadro por cuadro.
//  - Señas con movimiento → cuando la mano se mueve, se graba el movimiento; cuando se
//    detiene, se compara con DTW.
// Expone dos plantillas que la pantalla pone ENCIMA del video (overlay) y JUSTO DEBAJO (footer).
@Component({
  selector: 'app-recognize-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ShowOverlay],
  template: `
    <!-- Encima del video: la seña detectada, grande, sin tener que mirar a otro lado -->
    <ng-template #overlay>
      @if (cameraOn() && ready()) {
        @let r = reading();
        <div [class]="'detected detected--' + r.state" aria-live="polite">
          @if (r.state === 'sure') {
            <div class="detected__row">
              <span class="detected__label">{{ r.label }}</span>
              <span class="detected__confidence">{{ percent() }}%</span>
            </div>
          } @else {
            <span class="detected__message">
              @switch (r.state) {
                @case ('no-hand') {
                  Pon tu mano frente a la cámara
                }
                @case ('moving') {
                  Movimiento…
                }
                @default {
                  No estoy seguro
                }
              }
            </span>
          }
          @if (r.state === 'sure' || r.state === 'unsure') {
            <div class="confidence" aria-hidden="true">
              <div class="confidence__bar" [style.width.%]="percent()" [attr.data-ok]="r.confidence >= threshold()"></div>
              <div class="confidence__threshold" [style.left.%]="threshold() * 100"></div>
            </div>
          }
        </div>
      }
    </ng-template>

    <!-- Justo debajo del video: el texto que se va armando y sus botones -->
    <ng-template #footer>
      @if (!ready()) {
        <p class="muted">Cargando señas entrenadas…</p>
      } @else if (empty()) {
        <div class="card" style="align-items: flex-start">
          <h2>Primero hay que entrenar</h2>
          <p class="muted">Todavía no hay señas entrenadas. Graba algunos ejemplos para que la app pueda reconocerlas.</p>
          <button type="button" class="btn btn--primary" (click)="goTrain.emit()">Ir a entrenar</button>
        </div>
      } @else {
        <section class="card" style="padding: 12px; gap: 10px" aria-labelledby="titulo-texto">
          <h2 id="titulo-texto" class="sr-only">Texto reconocido</h2>
          <textarea
            class="input recognized"
            rows="2"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
            placeholder="Aquí se va armando el texto…"
            aria-labelledby="titulo-texto"
          ></textarea>
          <div class="toolbar">
            <button type="button" class="tool-btn" (click)="text.set(text() + ' ')">
              <app-icon name="space" />
              Espacio
            </button>
            <button type="button" class="tool-btn" (click)="deleteLast()" [disabled]="!text()">
              <app-icon name="backspace" />
              Borrar
            </button>
            <button type="button" class="tool-btn" (click)="text.set('')" [disabled]="!text()">
              <app-icon name="trash" />
              Todo
            </button>
            <button type="button" class="tool-btn" (click)="showText.set(text().trim())" [disabled]="!text().trim()">
              <app-icon name="expand" />
              Mostrar
            </button>
            <button type="button" class="tool-btn tool-btn--primary" (click)="sayAloud()" [disabled]="!text().trim()">
              <app-icon name="speaker" />
              {{ synthesis ? 'Decir' : 'Guardar' }}
            </button>
          </div>
        </section>
      }
    </ng-template>

    <!-- Lo demás (ajustes e información) va aparte: se usa poco -->
    @if (ready() && !empty()) {
      <details class="fold">
        <summary>
          <app-icon name="sliders" [size]="20" />
          Ajustes del reconocimiento
          <app-icon class="fold__chev" name="chevron-down" [size]="20" />
        </summary>
        <div class="fold__body">
          <p class="muted small">
            Sostén una seña quieta un segundo para agregarla al texto; las señas con movimiento se agregan al terminar
            el movimiento. Conozco {{ labelCount() }} {{ labelCount() === 1 ? 'seña' : 'señas' }}.
          </p>
          @if (packageInfo(); as p) {
            <p class="muted small">
              Incluye el paquete oficial v{{ p.version }}{{
                p.origen === 'sintetico' ? ' (datos sintéticos, generados por computadora)' : ''
              }}{{ unreviewed() ? ', que todavía no revisa una persona que sepa LSM' : '' }}. Si no reconoce bien tu
              mano, graba tus propios ejemplos en Entrenar.
            </p>
          }
          <div>
            <label for="umbral" class="label">Confianza mínima: {{ thresholdPercent() }}%</label>
            <input
              id="umbral"
              type="range"
              class="range"
              min="0.4"
              max="0.95"
              step="0.05"
              [value]="threshold()"
              (input)="threshold.set(+$any($event.target).value)"
            />
            <p class="muted small">
              Más alto = se equivoca menos, pero reconoce menos señas. Más bajo = reconoce más, pero se equivoca más.
            </p>
          </div>
        </div>
      </details>
    }

    @if (showText(); as t) {
      <app-show-overlay [text]="t" (close)="showText.set(null)" />
    }
  `,
})
export class RecognizePanel {
  readonly frame = input.required<FrameBox>();
  readonly cameraOn = input.required<boolean>();
  readonly goTrain = output<void>();

  readonly overlayTpl = viewChild<TemplateRef<unknown>>('overlay');
  readonly footerTpl = viewChild<TemplateRef<unknown>>('footer');

  protected readonly synthesis = isSynthesisSupported();
  private readonly knn = signal<KnnClassifier | null>(null);
  private readonly dtw = signal<DtwClassifier | null>(null);
  protected readonly labelCount = signal(0);
  protected readonly packageInfo = signal<OfficialPackageInfo | null>(null);
  protected readonly unreviewed = signal(false);
  protected readonly threshold = signal(0.7); // confianza mínima para aceptar una seña
  protected readonly reading = signal<Reading>({ state: 'no-hand', label: '', confidence: 0 });
  protected readonly text = signal('');
  protected readonly showText = signal<string | null>(null);

  protected readonly ready = computed(() => !!this.knn() && !!this.dtw());
  protected readonly empty = computed(() => (this.knn()?.size ?? 0) + (this.dtw()?.size ?? 0) === 0);
  protected readonly percent = computed(() => Math.round(this.reading().confidence * 100));
  protected readonly thresholdPercent = computed(() => Math.round(this.threshold() * 100));

  private lastAdded = ''; // evita agregar la misma seña muchas veces seguidas

  constructor() {
    // Cargar las señas (personales + paquete oficial) y crear los dos clasificadores.
    // Se repite si llega un paquete nuevo mientras la pantalla está abierta.
    this.load();
    const stop = onSignsChanged(() => this.load());
    inject(DestroyRef).onDestroy(stop);

    // Bucle de reconocimiento
    effect((onCleanup) => {
      const knn = this.knn();
      const dtw = this.dtw();
      const box = this.frame();
      if (!this.cameraOn() || !knn || !dtw || knn.size + dtw.size === 0) return;
      const id = untracked(() => this.startLoop(knn, dtw, box));
      onCleanup(() => clearInterval(id));
    });
  }

  private async load() {
    const { recognition: samples, official, packageInfo } = await loadAllSamples(currentLanguage.id);
    this.packageInfo.set(packageInfo);
    this.unreviewed.set(official.some((s) => !s.reviewed));
    const statics = samples.filter((s) => s.kind === 'static');
    const dynamics = samples.filter((s) => s.kind === 'dynamic' && s.frames);
    this.labelCount.set(new Set(samples.map((s) => s.label)).size);
    this.knn.set(new KnnClassifier(statics.map((s) => ({ label: s.label, vector: s.points }))));
    this.dtw.set(new DtwClassifier(dynamics.map((s) => ({ label: s.label, frames: s.frames! }))));
  }

  private addToText(label: string) {
    this.text.update((t) => {
      // Una letra se pega a lo anterior; una palabra se separa con espacios
      if (label.length <= 2 && currentLanguage.alphabet.includes(label)) return t + label;
      const sep = t && !t.endsWith(' ') ? ' ' : '';
      return `${t}${sep}${label} `;
    });
    vibrate(60);
  }

  private startLoop(knn: KnnClassifier, dtw: DtwClassifier, box: FrameBox): number {
    const candidate = { label: '', frames: 0 };
    let prev: HandFrame | null = null;
    let recent: HandFrame[] = []; // últimos cuadros, para no perder el inicio del movimiento
    let segment: HandFrame[] | null = null; // movimiento en curso
    let stillCount = 0;
    let showUntil = 0; // mientras tanto, se sigue mostrando la seña con movimiento reconocida

    const resetStatic = () => {
      candidate.label = '';
      candidate.frames = 0;
    };

    /** Terminó un movimiento: lo comparamos con las señas con movimiento (DTW). */
    const finishSegment = () => {
      const frames = segment ? (trimStill(segment) ?? segment) : [];
      segment = null;
      stillCount = 0;
      if (frames.length < 5) return;
      const prediction = dtw.predict(toSequence(frames));
      if (prediction && prediction.confidence >= this.threshold()) {
        this.reading.set({ state: 'sure', label: prediction.label, confidence: prediction.confidence });
        showUntil = performance.now() + SHOW_DYNAMIC_MS;
        this.lastAdded = prediction.label;
        this.addToText(prediction.label);
      } else {
        this.reading.set({ state: 'unsure', label: prediction?.label ?? '', confidence: prediction?.confidence ?? 0 });
      }
    };

    return window.setInterval(() => {
      const frame = box.current;
      const now = performance.now();

      if (!frame) {
        // Sin mano: si se estaba moviendo, termina el movimiento.
        // Reiniciamos todo, así se puede repetir la misma letra.
        if (segment) finishSegment();
        resetStatic();
        this.lastAdded = '';
        prev = null;
        recent = [];
        if (now > showUntil) this.reading.set({ state: 'no-hand', label: '', confidence: 0 });
        return;
      }
      if (frame.time === prev?.time) return; // todavía no hay un cuadro nuevo

      // ---- Señas con movimiento ----
      if (dtw.size > 0) {
        const energy = prev ? motionEnergy(prev, frame) : 0;
        if (!segment && energy > MOVING_ENERGY) {
          segment = [...recent, frame]; // empezó un movimiento
          stillCount = 0;
        } else if (segment) {
          segment.push(frame);
          stillCount = energy < STILL_ENERGY ? stillCount + 1 : 0;
          if (stillCount >= STILL_FRAMES_TO_END || segment.length > MAX_SEGMENT_FRAMES) finishSegment();
        }
        recent = [...recent.slice(-2), frame];
      }
      prev = frame;

      if (segment) {
        resetStatic();
        if (now > showUntil) this.reading.set({ state: 'moving', label: '', confidence: 0 });
        return;
      }
      if (now < showUntil) return;

      // ---- Señas quietas ----
      const prediction = knn.predict(frame.vector);
      if (!prediction || prediction.confidence < this.threshold()) {
        resetStatic();
        this.reading.set({ state: 'unsure', label: prediction?.label ?? '', confidence: prediction?.confidence ?? 0 });
        return;
      }

      // Contamos cuántas veces seguidas sale la misma seña
      if (candidate.label === prediction.label) candidate.frames++;
      else {
        candidate.label = prediction.label;
        candidate.frames = 1;
      }

      if (candidate.frames >= STABLE_FRAMES) {
        this.reading.set({ state: 'sure', label: prediction.label, confidence: prediction.confidence });
      } else {
        this.reading.update((r) => ({
          ...r,
          state: r.state === 'sure' ? 'sure' : 'unsure',
          confidence: prediction.confidence,
        }));
      }

      if (candidate.frames === HOLD_FRAMES && this.lastAdded !== prediction.label) {
        this.lastAdded = prediction.label;
        this.addToText(prediction.label);
      }
    }, TICK_MS);
  }

  // ---------- Acciones del texto ----------

  protected deleteLast() {
    this.text.update((t) => t.replace(/\s+$/, '').slice(0, -1));
  }

  protected sayAloud() {
    const clean = this.text().trim();
    if (!clean) return;
    // Reutilizamos el modo Conversación: se dice en voz alta y queda en su historial
    addHistory({ who: 'sorda', text: clean, time: Date.now() });
    speak(clean, { lang: currentLanguage.speechLocale });
  }
}
