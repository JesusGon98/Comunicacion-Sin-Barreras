import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { currentLanguage } from '../../config/language';
import type { OfficialPackageInfo } from '../../lib/db';
import { vibrate } from '../../lib/speech';
import {
  checkForUpdate,
  dismissForSession,
  downloadAndInstall,
  isDismissedForSession,
  type RemoteVersion,
} from '../../lib/updates';
import { Icon } from '../shared/icon';
import { errorText } from './platform';

type State =
  | { kind: 'hidden' }
  | { kind: 'available'; remote: RemoteVersion; current: OfficialPackageInfo | null }
  | { kind: 'downloading'; remote: RemoteVersion }
  | { kind: 'done'; version: number; signs: number }
  | { kind: 'error'; message: string; current: OfficialPackageInfo | null };

// Al abrir la app, revisa si hay un paquete de señas más nuevo en Google Drive.
// Sin internet (o si algo falla al revisar) no muestra nada: la app nunca se bloquea.
@Component({
  selector: 'app-update-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @let s = state();
    @switch (s.kind) {
      @case ('available') {
        @let a = available()!;
        <div class="banner banner--accent" role="alert">
          <app-icon name="sparkle" />
          <p class="banner__text">
            @if (a.current) {
              <strong>Hay señas nuevas (v{{ a.remote.version }})</strong>{{ a.remote.notas ? ': ' + a.remote.notas : '' }}.
            } @else {
              <strong>Falta el paquete oficial de señas (v{{ a.remote.version }}).</strong>
              Sin él, el reconocimiento casi no funciona. {{ a.remote.notas }}
            }
          </p>
          <div class="row">
            <button type="button" class="btn btn--ghost btn--sm" (click)="later(a.remote)">Más tarde</button>
            <button type="button" class="btn btn--primary btn--sm" (click)="update(a.remote, a.current)">
              Descargar
            </button>
          </div>
        </div>
      }
      @case ('downloading') {
        <div class="banner" role="status">
          <app-icon name="download" />
          <p class="banner__text">Descargando las señas… puedes seguir usando la app.</p>
        </div>
      }
      @case ('done') {
        @let d = done()!;
        <div class="banner banner--ok" role="status">
          <app-icon name="check" />
          <p class="banner__text">Señas actualizadas a la versión {{ d.version }} ({{ d.signs }} señas).</p>
          <button type="button" class="btn btn--ghost btn--sm" (click)="hide()">Cerrar</button>
        </div>
      }
      @case ('error') {
        @let f = failed()!;
        <div class="banner banner--error" role="alert">
          <app-icon name="info" />
          <p class="banner__text">
            No se pudo actualizar el paquete de señas. {{ f.message }}
            {{ f.current ? 'Se conserva el paquete anterior (v' + f.current.version + ').' : '' }}
          </p>
          <button type="button" class="btn btn--ghost btn--sm" (click)="hide()">Cerrar</button>
        </div>
      }
    }
  `,
})
export class UpdateNotice {
  protected readonly state = signal<State>({ kind: 'hidden' });

  protected readonly available = computed(() => {
    const s = this.state();
    return s.kind === 'available' ? s : null;
  });
  protected readonly done = computed(() => {
    const s = this.state();
    return s.kind === 'done' ? s : null;
  });
  protected readonly failed = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s : null;
  });

  constructor() {
    checkForUpdate(currentLanguage)
      .then((result) => {
        if (result.status !== 'available' || isDismissedForSession(result.remote.version)) return;
        this.state.set({ kind: 'available', remote: result.remote, current: result.current });
        vibrate(80);
      })
      .catch(() => {
        /* Al abrir la app, los errores de red se ignoran en silencio */
      });
  }

  protected hide() {
    this.state.set({ kind: 'hidden' });
  }

  protected async update(remote: RemoteVersion, current: OfficialPackageInfo | null) {
    this.state.set({ kind: 'downloading', remote });
    try {
      const r = await downloadAndInstall(currentLanguage, remote);
      this.state.set({ kind: 'done', version: r.version, signs: r.signs });
      vibrate([80, 60, 80]);
      setTimeout(() => {
        if (this.state().kind === 'done') this.hide();
      }, 8000);
    } catch (err) {
      this.state.set({ kind: 'error', message: errorText(err), current });
      vibrate([100, 60, 100]);
    }
  }

  protected later(remote: RemoteVersion) {
    dismissForSession(remote.version); // no volver a preguntar en esta sesión
    this.hide();
  }
}
