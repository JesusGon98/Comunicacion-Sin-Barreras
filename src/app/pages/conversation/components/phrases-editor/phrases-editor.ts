import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { DEFAULT_PHRASES } from '../../../../../lib/db';
import { Icon } from '../../../../shared/components/icon/icon';

// Hoja (desde abajo en celular) para editar las frases rápidas.
@Component({
  selector: 'app-phrases-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown.escape)': 'cancel.emit()' },
  templateUrl: './phrases-editor.html',
  styleUrl: './phrases-editor.css',
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
