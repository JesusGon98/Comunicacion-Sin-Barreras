import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { currentLanguage } from '../../../config/language';
import { getOfficialPackageInfo, getOfficialSamples, getSignSamples, type OfficialPackageInfo } from '../../../lib/db';
import { ensureBundledPackage } from '../../../lib/officialPackage';
import { onSignsChanged } from '../../../lib/signData';
import { checkForUpdate, downloadAndInstall, type RemoteVersion } from '../../../lib/updates';
import { InstallButton } from '../../core/components/install-button/install-button';
import { errorText } from '../../core/utils/platform';
import { Icon } from '../../shared/components/icon/icon';
import { TeamTools } from './components/team-tools/team-tools';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'message'; ok: boolean; text: string }
  | { kind: 'available'; remote: RemoteVersion }
  | { kind: 'downloading'; remote: RemoteVersion };

interface Stats {
  signs: number;
  examples: number;
  reviewed: number;
  personalSigns: number;
  personalExamples: number;
}

const TEAM_KEY = 'sin-barreras:herramientas-equipo';
const TAPS_TO_UNLOCK = 5;

function readTeamFlag(): boolean {
  try {
    return sessionStorage.getItem(TEAM_KEY) === '1';
  } catch {
    return false;
  }
}

// Pantalla de Ajustes.
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, InstallButton, TeamTools],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage {
  private readonly lang = currentLanguage;
  protected readonly info = signal<OfficialPackageInfo | null>(null);
  protected readonly stats = signal<Stats | null>(null);
  protected readonly check = signal<CheckState>({ kind: 'idle' });
  protected readonly teamUnlocked = signal(readTeamFlag());
  private taps = 0;

  protected readonly availableRemote = computed(() => {
    const c = this.check();
    return c.kind === 'available' ? c.remote : null;
  });
  protected readonly message = computed(() => {
    const c = this.check();
    return c.kind === 'message' ? c : null;
  });
  protected readonly searchLabel = computed(() => {
    const c = this.check();
    if (c.kind === 'checking') return 'Buscando…';
    if (c.kind === 'downloading') return `Descargando v${c.remote.version}…`;
    return 'Buscar actualizaciones';
  });

  constructor() {
    this.load();
    const stop = onSignsChanged(() => this.load());
    inject(DestroyRef).onDestroy(stop);
  }

  protected formatDate(ms: number): string {
    return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private async load() {
    await ensureBundledPackage(this.lang);
    const [pkg, official, personal] = await Promise.all([
      getOfficialPackageInfo(this.lang.id),
      getOfficialSamples(this.lang.id),
      getSignSamples(this.lang.id),
    ]);
    const refs = official.filter((s) => s.reference);
    this.info.set(pkg);
    this.stats.set({
      signs: new Set(official.map((s) => s.label)).size,
      examples: official.length - refs.length,
      reviewed: refs.filter((s) => s.reviewed).length,
      personalSigns: new Set(personal.map((s) => s.label)).size,
      personalExamples: personal.length,
    });
  }

  protected async search() {
    this.check.set({ kind: 'checking' });
    try {
      const r = await checkForUpdate(this.lang);
      if (r.status === 'not-configured') {
        this.check.set({
          kind: 'message',
          ok: false,
          text: 'Las actualizaciones todavía no están configuradas: faltan la API key y el ID del archivo en src/config/remote.ts.',
        });
      } else if (r.status === 'offline') {
        this.check.set({ kind: 'message', ok: false, text: 'No hay conexión a internet. Intenta de nuevo cuando tengas conexión.' });
      } else if (r.status === 'up-to-date') {
        this.check.set({
          kind: 'message',
          ok: true,
          text: `Tienes la versión más reciente (v${r.current?.version ?? r.remote.version}).`,
        });
      } else {
        this.check.set({ kind: 'available', remote: r.remote });
      }
    } catch (err) {
      this.check.set({ kind: 'message', ok: false, text: errorText(err, 'No se pudo revisar.') });
    }
  }

  protected async update(remote: RemoteVersion) {
    this.check.set({ kind: 'downloading', remote });
    try {
      const r = await downloadAndInstall(this.lang, remote);
      this.check.set({ kind: 'message', ok: true, text: `Señas actualizadas a la versión ${r.version} (${r.signs} señas).` });
    } catch (err) {
      const prev = this.info();
      this.check.set({
        kind: 'message',
        ok: false,
        text: `No se pudo actualizar. ${errorText(err)} ${prev ? `Se conserva el paquete anterior (v${prev.version}).` : ''}`,
      });
    }
  }

  /** Herramientas del equipo: se muestran tocando 5 veces la versión del paquete. */
  protected tapVersion() {
    this.taps++;
    if (this.taps >= TAPS_TO_UNLOCK && !this.teamUnlocked()) {
      try {
        sessionStorage.setItem(TEAM_KEY, '1');
      } catch {
        /* sin almacenamiento: solo dura mientras la pantalla esté abierta */
      }
      this.teamUnlocked.set(true);
    }
  }
}
