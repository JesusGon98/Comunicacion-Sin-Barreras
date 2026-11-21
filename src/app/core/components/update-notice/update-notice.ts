import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { currentLanguage } from '../../../../config/language';
import type { OfficialPackageInfo } from '../../../../lib/db';
import { vibrate } from '../../../../lib/speech';
import {
  checkForUpdate,
  dismissForSession,
  downloadAndInstall,
  isDismissedForSession,
  type RemoteVersion,
} from '../../../../lib/updates';
import { Icon } from '../../../shared/components/icon/icon';
import { errorText } from '../../utils/platform';

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
  templateUrl: './update-notice.html',
  styleUrl: './update-notice.css',
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
