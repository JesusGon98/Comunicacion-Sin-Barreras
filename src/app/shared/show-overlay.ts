import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Icon } from './icon';

/** Datos extra cuando la pantalla grande muestra la voz en vivo. */
export interface LiveInfo {
  /** true si el texto todavía es provisional (la persona sigue hablando). */
  interim: boolean;
  /** true si el micrófono está activado. */
  listening: boolean;
  /** Texto de estado del micrófono ("Escuchando…", etc.). */
  status: string;
}

/** Elige un tamaño de letra según lo largo del texto, para que quepa en pantalla. */
function fontSizeFor(text: string): string {
  const n = text.length;
  if (n <= 15) return '18vmin';
  if (n <= 40) return '12vmin';
  if (n <= 100) return '8vmin';
  if (n <= 200) return '6vmin';
  return '4.5vmin';
}

// Muestra un texto enorme a pantalla completa para enseñárselo a la otra persona.
// "Voltear" gira el texto 180° para quien está enfrente, del otro lado de la mesa.
@Component({
  selector: 'app-show-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Texto en grande">
      @if (live()?.listening) {
        <p class="overlay__status" role="status">
          <span class="pulse" aria-hidden="true"></span>
          {{ live()!.status }}
        </p>
      }

      <p
        class="overlay__text"
        [class.overlay__text--flipped]="flipped()"
        [class.overlay__text--interim]="dimmed()"
        [style.font-size]="fontSize()"
        [attr.aria-live]="live() ? 'polite' : null"
      >
        {{ shown() }}
      </p>

      <div class="overlay__bar">
        @if (live(); as l) {
          <button
            type="button"
            class="btn btn--lg"
            [class.btn--rec]="l.listening"
            [class.btn--primary]="!l.listening"
            (click)="toggleMic.emit()"
            [attr.aria-pressed]="l.listening"
          >
            <app-icon [name]="l.listening ? 'mic-off' : 'mic'" />
            {{ l.listening ? 'Dejar de escuchar' : 'Escuchar' }}
          </button>
        }
        <button type="button" class="btn btn--lg btn--outline" (click)="flipped.set(!flipped())">
          <app-icon name="flip" />
          Voltear
        </button>
        <button
          type="button"
          class="btn btn--lg"
          [class.btn--primary]="!live()"
          [class.btn--outline]="!!live()"
          (click)="close.emit()"
          data-autofocus
        >
          <app-icon name="close" />
          Cerrar
        </button>
      </div>
    </div>
  `,
})
export class ShowOverlay {
  readonly text = input.required<string>();
  /** Si viene, la vista está "en vivo" y el texto cambia mientras la persona habla. */
  readonly live = input<LiveInfo | null>(null);
  readonly close = output<void>();
  readonly toggleMic = output<void>();

  protected readonly flipped = signal(false);

  /** En vivo y sin texto todavía: mostramos un aviso en lugar de la pantalla vacía. */
  private readonly placeholder = computed(() => !!this.live() && !this.text());
  protected readonly shown = computed(() =>
    this.placeholder() ? (this.live()!.listening ? 'Escuchando…' : 'Toca «Escuchar» para empezar') : this.text(),
  );
  protected readonly dimmed = computed(() => this.placeholder() || !!this.live()?.interim);
  protected readonly fontSize = computed(() => fontSizeFor(this.shown()));

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      // Intentamos usar la pantalla completa real del navegador (si lo permite)
      host.querySelector<HTMLElement>('.overlay')?.requestFullscreen?.().catch(() => {});
      host.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
    inject(DestroyRef).onDestroy(() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
  }
}
