import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { currentLanguage } from '../../config/language';
import { exportSigns, importSigns } from '../../lib/share';
import { errorText } from '../core/platform';
import { Icon } from '../shared/icon';

// Exportar e importar las señas entrenadas como archivo .json.
@Component({
  selector: 'app-share-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <details class="fold">
      <summary>
        <app-icon name="upload" [size]="20" />
        Compartir mis señas
        <app-icon class="fold__chev" name="chevron-down" [size]="20" />
      </summary>
      <div class="fold__body">
        <p class="muted">
          Guarda tus señas en un archivo para pasarlas a otro dispositivo o compartirlas. Al importar, las señas del
          archivo se <strong>suman</strong> a las que ya tienes.
        </p>
        <label class="switch">
          <input type="checkbox" [checked]="includeMedia()" (change)="includeMedia.set($any($event.target).checked)" />
          Incluir mis fotos y videos (el archivo será más grande)
        </label>
        <div class="row">
          <button type="button" class="btn btn--soft" (click)="doExport()" [disabled]="busy()">
            <app-icon name="download" [size]="20" />
            Exportar
          </button>
          <label class="btn btn--outline" [class.btn--disabled]="busy()">
            <app-icon name="upload" [size]="20" />
            Importar
            <input
              type="file"
              accept=".json,application/json"
              class="sr-only"
              (change)="doImport($event)"
              [disabled]="busy()"
            />
          </label>
        </div>
        @if (message(); as m) {
          <div class="banner" [class.banner--ok]="m.ok" [class.banner--error]="!m.ok" role="status">
            <app-icon [name]="m.ok ? 'check' : 'info'" />
            <p class="banner__text">{{ m.text }}</p>
          </div>
        }
      </div>
    </details>
  `,
})
export class SharePanel {
  readonly imported = output<void>();
  protected readonly includeMedia = signal(false);
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly busy = signal(false);

  protected async doExport() {
    this.busy.set(true);
    try {
      const n = await exportSigns(currentLanguage.id, this.includeMedia());
      this.message.set(
        n === 0
          ? { ok: false, text: 'No hay señas para exportar todavía.' }
          : { ok: true, text: `Se descargó un archivo con ${n} ejemplos.` },
      );
    } catch {
      this.message.set({ ok: false, text: 'No se pudo crear el archivo.' });
    }
    this.busy.set(false);
  }

  protected async doImport(e: Event) {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.busy.set(true);
    try {
      const r = await importSigns(file, currentLanguage.id);
      const parts = [`Se agregaron ${r.added} ejemplos`];
      if (r.skipped) parts.push(`${r.skipped} ya existían`);
      if (r.invalid) parts.push(`${r.invalid} tenían errores y se ignoraron`);
      if (r.media) parts.push(`${r.media} fotos o videos`);
      this.message.set({ ok: true, text: parts.join(', ') + '.' });
      this.imported.emit();
    } catch (err) {
      this.message.set({ ok: false, text: errorText(err, 'No se pudo leer el archivo.') });
    }
    this.busy.set(false);
  }
}
