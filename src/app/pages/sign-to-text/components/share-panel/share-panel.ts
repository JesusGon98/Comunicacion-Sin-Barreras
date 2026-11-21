import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { currentLanguage } from '../../../../../config/language';
import { exportSigns, importSigns } from '../../../../../lib/share';
import { errorText } from '../../../../core/utils/platform';
import { Icon } from '../../../../shared/components/icon/icon';

// Exportar e importar las señas entrenadas como archivo .json.
@Component({
  selector: 'app-share-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './share-panel.html',
  styleUrl: './share-panel.css',
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
