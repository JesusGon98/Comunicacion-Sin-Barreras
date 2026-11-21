import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { DEFAULT_PHRASES } from '../../lib/db';
import { Icon } from '../shared/icon';

// Hoja (desde abajo en celular) para editar las frases rápidas.
@Component({
  selector: 'app-phrases-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown.escape)': 'cancel.emit()' },
  template: `
    <div class="dialog-backdrop" (click)="cancel.emit()">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-frases"
        (click)="$event.stopPropagation()"
      >
        <div class="card__head">
          <h2 id="titulo-frases">Frases rápidas</h2>
          <button type="button" class="icon-btn" aria-label="Cerrar" (click)="cancel.emit()">
            <app-icon name="close" />
          </button>
        </div>
        <p class="muted small">Toca una frase en la conversación y la app la dice en voz alta.</p>

        <div class="phrases-edit">
          @for (phrase of draft(); track $index) {
            <div class="phrases-edit__row">
              <input
                class="input"
                [value]="phrase"
                [attr.aria-label]="'Frase ' + ($index + 1)"
                (input)="edit($index, $any($event.target).value)"
              />
              <button
                type="button"
                class="icon-btn"
                (click)="remove($index)"
                [attr.aria-label]="'Borrar la frase ' + phrase"
              >
                <app-icon name="trash" [size]="20" />
              </button>
            </div>
          } @empty {
            <p class="muted">No hay frases. Agrega una.</p>
          }
        </div>

        <div class="row">
          <button type="button" class="btn btn--soft" (click)="draft.set([...draft(), ''])">
            <app-icon name="plus" [size]="20" />
            Agregar frase
          </button>
          <button type="button" class="btn btn--ghost" (click)="draft.set([...defaults])">Restaurar originales</button>
        </div>

        <div class="row row--end">
          <button type="button" class="btn btn--outline" (click)="cancel.emit()">Cancelar</button>
          <button type="button" class="btn btn--primary" (click)="save()">Guardar</button>
        </div>
      </div>
    </div>
  `,
})
export class PhrasesEditor {
  readonly phrases = input.required<string[]>();
  readonly saved = output<string[]>();
  readonly cancel = output<void>();

  protected readonly defaults = DEFAULT_PHRASES;
  protected readonly draft = signal<string[]>([]);

  ngOnInit() {
    this.draft.set([...this.phrases()]);
  }

  protected edit(i: number, value: string) {
    this.draft.update((d) => d.map((p, j) => (j === i ? value : p)));
  }

  protected remove(i: number) {
    this.draft.update((d) => d.filter((_, j) => j !== i));
  }

  protected save() {
    // Quitamos frases vacías antes de guardar
    this.saved.emit(this.draft().map((p) => p.trim()).filter(Boolean));
  }
}
