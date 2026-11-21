import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { currentLanguage } from '../../config/language';
import { buildPackage, buildVersionFile, downloadBytes, type BuiltPackage } from '../../lib/packageBuilder';
import { downloadJson } from '../../lib/share';
import { loadAllSamples, type LoadedSamples } from '../../lib/signData';
import { errorText } from '../core/platform';
import { Icon } from '../shared/icon';

/** Fecha de hoy en la zona horaria del dispositivo, como "2026-10-31". */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Row {
  label: string;
  personal: number;
  official: number;
}

// Herramienta del equipo: "Generar paquete".
// Crea lsm-senas-vN.json y lsm-version.json (con el sha256 ya calculado), listos para subir a Drive.
@Component({
  selector: 'app-team-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (!data()) {
      <p class="muted">Cargando señas…</p>
    } @else {
      <section class="card" aria-labelledby="titulo-equipo" style="border-style: dashed">
        <div class="card__head">
          <span class="card__icon"><app-icon name="sliders" [size]="20" /></span>
          <h2 id="titulo-equipo">Herramientas del equipo: generar paquete</h2>
        </div>
        <p class="muted small">
          Crea una nueva versión del paquete oficial con las señas elegidas. Solo para el equipo que revisa las señas.
        </p>

        <div class="team-grid">
          <div>
            <label class="label" for="pkg-version">Versión</label>
            <input
              id="pkg-version"
              class="input"
              type="number"
              min="1"
              [value]="version()"
              (input)="version.set(+$any($event.target).value); built.set(null)"
            />
          </div>
          <div>
            <label class="label" for="pkg-fecha">Fecha</label>
            <input
              id="pkg-fecha"
              class="input"
              type="date"
              [value]="fecha()"
              (input)="fecha.set($any($event.target).value)"
            />
          </div>
          <div>
            <label class="label" for="pkg-origen">Origen de los datos</label>
            <input
              id="pkg-origen"
              class="input"
              [value]="origen()"
              [placeholder]="suggestedOrigin()"
              (input)="origen.set($any($event.target).value)"
            />
          </div>
        </div>
        @if (version() <= currentVersion()) {
          <div class="banner banner--warning">
            <app-icon name="info" />
            <p class="banner__text">
              La versión debe ser mayor que la actual (v{{ currentVersion() }}); si no, las apps no la descargarán.
            </p>
          </div>
        }
        <div>
          <label class="label" for="pkg-notas">Notas (se muestran en el aviso de actualización)</label>
          <input
            id="pkg-notas"
            class="input"
            [value]="notas()"
            placeholder="Por ejemplo: Se agregaron 20 palabras"
            (input)="notas.set($any($event.target).value)"
          />
        </div>

        <label class="switch">
          <input
            type="checkbox"
            [checked]="useOfficial()"
            (change)="useOfficial.set($any($event.target).checked); built.set(null)"
          />
          Incluir también los ejemplos del paquete actual
        </label>

        <div class="row">
          <button type="button" class="btn btn--sm btn--outline" (click)="selectAll()">Elegir todas</button>
          <button type="button" class="btn btn--sm btn--outline" (click)="clearAll()">
            Quitar todas
          </button>
        </div>

        <div class="table-wrap">
          <table class="team-table">
            <thead>
              <tr>
                <th>Incluir</th>
                <th>Seña</th>
                <th>Aquí</th>
                <th>Paquete</th>
                <th>Revisada</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.label) {
                <tr [class.team-table__off]="!included().has(r.label)">
                  <td>
                    <input
                      type="checkbox"
                      [attr.aria-label]="'Incluir ' + r.label"
                      [checked]="included().has(r.label)"
                      (change)="toggle(included, r.label)"
                    />
                  </td>
                  <td>
                    <strong>{{ r.label }}</strong>
                  </td>
                  <td>{{ r.personal || '—' }}</td>
                  <td>
                    @if (useOfficial()) {
                      {{ r.official || '—' }}
                    } @else {
                      <s>{{ r.official || '—' }}</s>
                    }
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      [attr.aria-label]="r.label + ' revisada por una persona que sabe LSM'"
                      [checked]="reviewed().has(r.label)"
                      (change)="toggle(reviewed, r.label)"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (error(); as e) {
          <div class="banner banner--error">
            <app-icon name="info" />
            <p class="banner__text">{{ e }}</p>
          </div>
        }

        <button type="button" class="btn btn--primary btn--lg" (click)="generate()" [disabled]="busy()">
          {{ busy() ? 'Generando…' : '1. Generar ' + langId + '-senas-v' + version() + '.json' }}
        </button>

        @if (built(); as b) {
          <div class="banner banner--ok" style="flex-direction: column; align-items: stretch">
            <p>
              ✓ Se descargó <strong>{{ b.fileName }}</strong> ({{ kb(b) }} KB, {{ b.signCount }} señas,
              {{ b.exampleCount }} ejemplos).
            </p>
            <p class="small">
              sha256: <code class="code">{{ b.sha256 }}</code>
            </p>
            <ol class="steps-list">
              <li>Sube {{ b.fileName }} a la carpeta de Google Drive y compártelo como «Cualquier persona con el enlace».</li>
              <li>Copia su ID (la parte larga del enlace: drive.google.com/file/d/<strong>ID</strong>/view) y pégalo aquí:</li>
            </ol>
            <input
              class="input"
              [value]="driveId()"
              (input)="driveId.set($any($event.target).value)"
              placeholder="ID del paquete en Google Drive"
              aria-label="ID del paquete en Google Drive"
            />
            <button type="button" class="btn btn--primary" (click)="downloadVersion()">
              2. Descargar {{ langId }}-version.json
            </button>
            <p class="muted small">
              3. En Drive, reemplaza el {{ langId }}-version.json anterior con este (usa «Administrar versiones › Subir
              nueva versión» para que conserve su mismo ID). Las apps lo verán la próxima vez que se abran con internet.
            </p>
          </div>
        }
      </section>
    }
  `,
})
export class TeamTools {
  readonly currentVersion = input.required<number>();
  readonly currentOrigin = input.required<string>();

  private readonly lang = currentLanguage;
  protected readonly langId = currentLanguage.id;
  protected readonly data = signal<LoadedSamples | null>(null);
  protected readonly included = signal<Set<string>>(new Set());
  protected readonly reviewed = signal<Set<string>>(new Set());
  protected readonly useOfficial = signal(true);
  protected readonly version = signal(1);
  protected readonly fecha = signal(todayLocal());
  protected readonly notas = signal('');
  protected readonly origen = signal('');
  protected readonly built = signal<BuiltPackage | null>(null);
  protected readonly driveId = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  /** Tabla de señas: cuántos ejemplos hay de cada una en cada fuente. */
  protected readonly rows = computed<Row[]>(() => {
    const data = this.data();
    if (!data) return [];
    const map = new Map<string, Row>();
    for (const s of data.recognition) {
      const row = map.get(s.label) ?? { label: s.label, personal: 0, official: 0 };
      if (s.source === 'personal') row.personal++;
      else row.official++;
      map.set(s.label, row);
    }
    // Primero las letras en el orden del alfabeto, luego las palabras
    const order = (l: string) => {
      const i = this.lang.alphabet.indexOf(l);
      return i >= 0 ? i : 1000;
    };
    return [...map.values()].sort((a, b) => order(a.label) - order(b.label) || a.label.localeCompare(b.label, 'es'));
  });

  protected readonly suggestedOrigin = computed(() => {
    const included = this.included();
    const hasPersonal = this.rows().some((r) => included.has(r.label) && r.personal > 0);
    const current = this.currentOrigin();
    if (hasPersonal && this.useOfficial() && current) return `${current} + grabaciones`;
    if (hasPersonal) return 'grabaciones';
    return current;
  });

  constructor() {
    loadAllSamples(this.lang.id).then((loaded) => {
      this.data.set(loaded);
      this.included.set(new Set(loaded.recognition.map((s) => s.label)));
      // Por defecto, "revisada" se copia del paquete actual
      this.reviewed.set(new Set(loaded.official.filter((s) => s.reviewed).map((s) => s.label)));
    });
    effect(() => this.version.set(this.currentVersion() + 1));
  }

  protected kb(b: BuiltPackage) {
    return Math.round(b.bytes.length / 1024);
  }

  protected clearAll() {
    this.included.set(new Set());
    this.built.set(null);
  }

  protected selectAll() {
    this.included.set(new Set(this.rows().map((r) => r.label)));
    this.built.set(null);
  }

  protected toggle(target: typeof this.included, label: string) {
    const next = new Set(target());
    if (next.has(label)) next.delete(label);
    else next.add(label);
    target.set(next);
    this.built.set(null); // cualquier cambio invalida el paquete ya generado
  }

  protected async generate() {
    const data = this.data();
    if (!data) return;
    const version = this.version();
    this.error.set('');
    if (!Number.isInteger(version) || version < 1) {
      this.error.set('La versión debe ser un número entero mayor que 0.');
      return;
    }
    if (!this.notas().trim()) {
      this.error.set('Escribe una nota corta (por ejemplo «Se agregaron 20 palabras»).');
      return;
    }

    const included = this.included();
    const reviewed = this.reviewed();
    const useOfficial = this.useOfficial();
    const signs = this.rows()
      .filter((r) => included.has(r.label))
      .map((r) => ({
        label: r.label,
        reviewed: reviewed.has(r.label),
        examples: data.recognition.filter((s) => s.label === r.label && (s.source === 'personal' || useOfficial)),
      }))
      .filter((s) => s.examples.length > 0);
    if (signs.length === 0) {
      this.error.set('No hay ninguna seña con ejemplos para incluir.');
      return;
    }

    this.busy.set(true);
    try {
      const pkg = await buildPackage({
        lang: this.lang,
        version,
        fecha: this.fecha(),
        origen: this.origen().trim() || this.suggestedOrigin(),
        notas: this.notas().trim(),
        signs,
      });
      if (!pkg.sha256) throw new Error('No se pudo calcular el sha256 (se necesita https o localhost).');
      downloadBytes(pkg.bytes, pkg.fileName);
      this.built.set(pkg);
    } catch (err) {
      this.error.set(errorText(err, 'No se pudo generar el paquete.'));
    }
    this.busy.set(false);
  }

  protected downloadVersion() {
    const built = this.built();
    if (!built) return;
    downloadJson(
      buildVersionFile(built, { version: this.version(), fecha: this.fecha(), notas: this.notas().trim() }, this.driveId()),
      `${this.lang.id}-version.json`,
    );
  }
}
