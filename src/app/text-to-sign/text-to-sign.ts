import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { currentLanguage } from '../../config/language';
import { getAllMedia } from '../../lib/db';
import { sequenceToPoses } from '../../lib/motion';
import { loadAllSamples, onSignsChanged, samplesForDisplay } from '../../lib/signData';
import { representativePose, representativeSequence, textToSigns, type SignToken } from '../../lib/signs';
import { poseBounds } from '../../lib/skeleton';
import { Icon } from '../shared/icon';
import { MediaEditor } from './media-editor';
import { SignPlayer, type MediaInfo, type SignAnimation } from './sign-player';

// Modo 2: Texto → Señas.
@Component({
  selector: 'app-text-to-sign',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, SignPlayer, MediaEditor],
  template: `
    <section class="page page--signs" aria-labelledby="titulo-texto-senas">
      <header class="page-head">
        <div class="page-head__text">
          <h1 id="titulo-texto-senas">Ver señas</h1>
          <p class="page-head__intro">
            Escribe una palabra o frase y la app la muestra en señas. Si no conoce una palabra, la deletrea.
          </p>
        </div>
      </header>

      @if (loaded() && animations().size === 0 && media().size === 0) {
        <div class="banner banner--warning">
          <app-icon name="info" />
          <p class="banner__text">
            Todavía no hay señas grabadas. Se graban en
            <a routerLink="/senas-a-texto">Cámara › Entrenar</a> y aquí se muestran con una mano animada.
          </p>
        </div>
      }

      <form class="card" (submit)="submit($event)">
        <label for="texto-senas" class="sr-only">Texto para mostrar en señas</label>
        <div class="field-action">
          <input
            id="texto-senas"
            class="input"
            [value]="input()"
            (input)="input.set($any($event.target).value)"
            placeholder="Por ejemplo: hola"
            autocomplete="off"
            enterkeyhint="go"
          />
          <button type="submit" class="btn btn--primary" [disabled]="!input().trim()">
            <app-icon name="play" [size]="18" />
            <span>Mostrar</span>
          </button>
        </div>
        <div class="stats">
          <span class="badge">{{ letterCount() }} de {{ alphabetSize }} letras</span>
          <span class="badge">{{ wordLabels().length }} {{ wordLabels().length === 1 ? 'palabra' : 'palabras' }}</span>
          @if (media().size > 0) {
            <span class="badge badge--accent">{{ media().size }} fotos/videos tuyos</span>
          }
        </div>
        @if (media().size > 0) {
          <label class="switch">
            <input type="checkbox" [checked]="useMedia()" (change)="useMedia.set($any($event.target).checked)" />
            Usar mis fotos y videos cuando existan
          </label>
        }
      </form>

      @if (tokens().length > 0) {
        <section class="card" aria-label="Reproductor de señas">
          <app-sign-player
            [tokens]="tokens()"
            [animations]="animations()"
            [packageVersion]="packageVersion()"
            [media]="media()"
            [useMedia]="useMedia()"
            (currentChange)="current.set($event)"
          />
        </section>
        @if (currentLabel(); as l) {
          <app-media-editor [label]="l" [current]="media().get(l)" (changed)="loadMedia()" />
        }
      } @else {
        <div class="card" style="align-items: center; text-align: center; padding: 36px 18px">
          <span class="card__icon" style="width: 64px; height: 64px; border-radius: 20px">
            <app-icon name="hand" [size]="34" />
          </span>
          <p class="muted">Escribe arriba y toca <strong>Mostrar</strong> para ver la mano.</p>
        </div>
      }
    </section>
  `,
})
export class TextToSignPage {
  private readonly lang = currentLanguage;
  protected readonly alphabetSize = this.lang.alphabet.length;

  protected readonly loaded = signal(false);
  protected readonly animations = signal<Map<string, SignAnimation>>(new Map());
  protected readonly media = signal<Map<string, MediaInfo>>(new Map());
  protected readonly input = signal('');
  protected readonly tokens = signal<SignToken[]>([]);
  protected readonly useMedia = signal(true);
  protected readonly current = signal<SignToken | null>(null);
  protected readonly packageVersion = signal<number | null>(null);

  /** Las señas que no son letras del alfabeto son palabras del diccionario. */
  protected readonly wordLabels = computed(() => {
    const labels = new Set([...this.animations().keys(), ...this.media().keys()]);
    return [...labels].filter((l) => !this.lang.alphabet.includes(l));
  });
  protected readonly letterCount = computed(
    () => [...this.animations().keys()].filter((l) => this.lang.alphabet.includes(l)).length,
  );
  protected readonly currentLabel = computed(() => {
    const c = this.current();
    return c && (c.kind === 'letter' || c.kind === 'word') ? c.label : null;
  });

  constructor() {
    this.loadSigns();
    this.loadMedia();
    const stop = onSignsChanged(() => this.loadSigns()); // si llega un paquete nuevo, recargamos
    inject(DestroyRef).onDestroy(() => {
      stop();
      // Al salir de la pantalla liberamos la memoria de los archivos
      this.media().forEach((m) => URL.revokeObjectURL(m.url));
    });
  }

  // De cada seña elegimos su ejemplo más típico (o la "referencia" del paquete).
  // Si una seña está en el paquete oficial y también la grabó el usuario, se muestra la del usuario.
  private async loadSigns() {
    const loaded = await loadAllSamples(this.lang.id);
    const samples = samplesForDisplay(loaded);
    const statics = new Map<string, number[][]>();
    const dynamics = new Map<string, number[][][]>();
    const origin = new Map<string, Pick<SignAnimation, 'source' | 'reviewed'>>();
    for (const s of samples) {
      if (s.kind === 'dynamic' && s.frames) dynamics.set(s.label, [...(dynamics.get(s.label) ?? []), s.frames]);
      else if (s.kind === 'static') statics.set(s.label, [...(statics.get(s.label) ?? []), s.points]);
      if (!origin.has(s.label)) origin.set(s.label, { source: s.source, reviewed: s.source === 'personal' || !!s.reviewed });
    }
    const map = new Map<string, SignAnimation>();
    for (const [label, examples] of statics) {
      map.set(label, { kind: 'static', pose: representativePose(examples), ...origin.get(label)! });
    }
    // Si una seña tiene grabaciones con movimiento, preferimos esas
    for (const [label, examples] of dynamics) {
      const frames = sequenceToPoses(representativeSequence(examples));
      map.set(label, { kind: 'dynamic', frames, bounds: poseBounds(frames), ...origin.get(label)! });
    }
    this.animations.set(map);
    this.packageVersion.set(loaded.packageInfo?.version ?? null);
    this.loaded.set(true);
  }

  /** Cargar fotos y videos propios. */
  protected async loadMedia() {
    const list = await getAllMedia(this.lang.id);
    const old = this.media();
    this.media.set(new Map(list.map((m) => [m.label, { type: m.type, url: URL.createObjectURL(m.blob) }])));
    old.forEach((m) => URL.revokeObjectURL(m.url));
  }

  protected submit(e: Event) {
    e.preventDefault();
    this.tokens.set(textToSigns(this.input(), this.wordLabels(), this.lang));
    (document.activeElement as HTMLElement | null)?.blur(); // cierra el teclado del celular
  }
}
