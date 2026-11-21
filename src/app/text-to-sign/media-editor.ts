import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { currentLanguage } from '../../config/language';
import { deleteMedia, saveMedia } from '../../lib/db';
import { Icon } from '../shared/icon';
import { CaptureDialog } from './capture-dialog';
import type { MediaInfo } from './sign-player';

const MAX_FILE_MB = 25;

// Permite asociar una foto o un video propio a una seña (en vez de la mano animada).
@Component({
  selector: 'app-media-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CaptureDialog],
  template: `
    <details class="fold">
      <summary>
        <app-icon name="camera" [size]="20" />
        Foto o video propio de «{{ label() }}»
        @if (current()) {
          <span class="badge badge--ok">Tiene {{ current()!.type === 'video' ? 'video' : 'foto' }}</span>
        }
        <app-icon class="fold__chev" name="chevron-down" [size]="20" />
      </summary>
      <div class="fold__body">
        <p class="muted">
          @if (current(); as c) {
            Esta seña tiene {{ c.type === 'video' ? 'un video' : 'una foto' }} propio.
          } @else {
            Graba tu propia foto o video de esta seña para mostrarlo en vez de la mano animada.
          }
        </p>
        <div class="row">
          <button type="button" class="btn btn--soft" (click)="capturing.set(true)">
            <app-icon name="camera" [size]="20" />
            Usar la cámara
          </button>
          <label class="btn btn--outline">
            <app-icon name="upload" [size]="20" />
            Subir archivo
            <input type="file" accept="image/*,video/*" class="sr-only" (change)="onFile($event)" />
          </label>
          @if (current()) {
            <button type="button" class="btn btn--danger" (click)="remove()">
              <app-icon name="trash" [size]="20" />
              Quitar
            </button>
          }
        </div>
        @if (error(); as e) {
          <div class="banner banner--error">
            <app-icon name="info" />
            <p class="banner__text">{{ e }}</p>
          </div>
        }
        <p class="muted small">
          Usa solo fotos y videos grabados por ti o por personas que te dieron permiso. No copies imágenes de
          diccionarios de internet.
        </p>
      </div>
    </details>

    @if (capturing()) {
      <app-capture-dialog [label]="label()" (captured)="save($event)" (close)="capturing.set(false)" />
    }
  `,
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
