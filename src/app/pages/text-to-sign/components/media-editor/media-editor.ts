import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { currentLanguage } from '../../../../../config/language';
import { deleteMedia, saveMedia } from '../../../../../lib/db';
import { Icon } from '../../../../shared/components/icon/icon';
import { CaptureDialog } from '../capture-dialog/capture-dialog';
import type { MediaInfo } from '../sign-player/sign-player';

const MAX_FILE_MB = 25;

// Permite asociar una foto o un video propio a una seña (en vez de la mano animada).
@Component({
  selector: 'app-media-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CaptureDialog],
  templateUrl: './media-editor.html',
  styleUrl: './media-editor.css',
})
export class MediaEditor {
  /** Seña a la que se asocia la foto o el video. */
  readonly label = input.required<string>();
  readonly current = input<MediaInfo | undefined>();
  readonly changed = output<void>();

  protected readonly capturing = signal(false);
  protected readonly error = signal('');

  protected async save(blob: Blob) {
    this.capturing.set(false);
    this.error.set('');
    await saveMedia(currentLanguage.id, this.label(), blob);
    this.changed.emit();
  }

  protected onFile(e: Event) {
    const inputEl = e.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
      this.error.set('El archivo debe ser una foto o un video.');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      this.error.set(`El archivo es muy grande (máximo ${MAX_FILE_MB} MB).`);
      return;
    }
    this.save(file);
  }

  protected async remove() {
    const what = this.current()?.type === 'video' ? 'grabación' : 'foto';
    if (!window.confirm(`¿Quitar la ${what} de «${this.label()}»?`)) return;
    await deleteMedia(currentLanguage.id, this.label());
    this.changed.emit();
  }
}
