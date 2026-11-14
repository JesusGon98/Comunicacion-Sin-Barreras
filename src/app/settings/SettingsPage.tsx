import { useCallback, useEffect, useRef, useState } from 'react';
import { currentLanguage } from '../../config/language';
import { getOfficialPackageInfo, getOfficialSamples, getSignSamples, type OfficialPackageInfo } from '../../lib/db';
import { ensureBundledPackage } from '../../lib/officialPackage';
import { onSignsChanged } from '../../lib/signData';
import { checkForUpdate, downloadAndInstall, type RemoteVersion } from '../../lib/updates';
import { InstallButton } from '../InstallButton';
import { TeamTools } from './TeamTools';

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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

// Pantalla de Ajustes.
export function SettingsPage() {
  const lang = currentLanguage;
  const [info, setInfo] = useState<OfficialPackageInfo | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [teamUnlocked, setTeamUnlocked] = useState(() => sessionStorage.getItem(TEAM_KEY) === '1');
  const taps = useRef(0);

  const load = useCallback(async () => {
    await ensureBundledPackage(lang);
    const [pkg, official, personal] = await Promise.all([
      getOfficialPackageInfo(lang.id),
      getOfficialSamples(lang.id),
      getSignSamples(lang.id),
    ]);
    const refs = official.filter((s) => s.reference);
    setInfo(pkg);
    setStats({
      signs: new Set(official.map((s) => s.label)).size,
      examples: official.length - refs.length,
      reviewed: refs.filter((s) => s.reviewed).length,
      personalSigns: new Set(personal.map((s) => s.label)).size,
      personalExamples: personal.length,
    });
  }, [lang]);

  useEffect(() => {
    load();
    return onSignsChanged(load);
  }, [load]);

  const search = async () => {
    setCheck({ kind: 'checking' });
    try {
      const r = await checkForUpdate(lang);
      if (r.status === 'not-configured') {
        setCheck({
          kind: 'message',
          ok: false,
          text: 'Las actualizaciones todavía no están configuradas: faltan la API key y el ID del archivo en src/config/remote.ts.',
        });
      } else if (r.status === 'offline') {
        setCheck({ kind: 'message', ok: false, text: 'No hay conexión a internet. Intenta de nuevo cuando tengas conexión.' });
      } else if (r.status === 'up-to-date') {
        setCheck({ kind: 'message', ok: true, text: `Tienes la versión más reciente (v${r.current?.version ?? r.remote.version}).` });
      } else {
        setCheck({ kind: 'available', remote: r.remote });
      }
    } catch (err) {
      setCheck({ kind: 'message', ok: false, text: err instanceof Error ? err.message : 'No se pudo revisar.' });
    }
  };

  const update = async (remote: RemoteVersion) => {
    setCheck({ kind: 'downloading', remote });
    try {
      const r = await downloadAndInstall(lang, remote);
      setCheck({ kind: 'message', ok: true, text: `✓ Señas actualizadas a la versión ${r.version} (${r.signs} señas).` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido.';
      setCheck({
        kind: 'message',
        ok: false,
        text: `No se pudo actualizar. ${msg} ${info ? `Se conserva el paquete anterior (v${info.version}).` : ''}`,
      });
    }
  };

  // Herramientas del equipo: se muestran tocando 5 veces la versión del paquete
  const tapVersion = () => {
    taps.current++;
    if (taps.current >= TAPS_TO_UNLOCK && !teamUnlocked) {
      sessionStorage.setItem(TEAM_KEY, '1');
      setTeamUnlocked(true);
    }
  };

  return (
    <section className="mode" aria-labelledby="titulo-ajustes">
      <h1 id="titulo-ajustes">Ajustes</h1>

      {/* En celular no hay barra lateral: el botón "Instalar app" vive aquí */}
      <div className="mobile-install">
        <InstallButton />
      </div>

      <section className="card" aria-labelledby="titulo-paquete">
        <h2 id="titulo-paquete">Paquete oficial de señas</h2>
        {info ? (
          <dl className="facts">
            <dt>Versión</dt>
            <dd>
              {/* Tocar aquí 5 veces muestra las herramientas del equipo */}
              <button type="button" className="facts__plain" onClick={tapVersion}>
                v{info.version}
              </button>
            </dd>
            <dt>Publicado</dt>
            <dd>{info.fecha || '—'}</dd>
            <dt>Origen</dt>
            <dd>{info.fuente === 'drive' ? `Descargado de Google Drive el ${formatDate(info.downloadedAt)}` : 'Incluido con la app'}</dd>
            {info.origen && (
              <>
                <dt>Datos</dt>
                <dd>{info.origen === 'sintetico' ? 'Sintéticos (generados por computadora)' : info.origen}</dd>
              </>
            )}
            {stats && (
              <>
                <dt>Contenido</dt>
                <dd>
                  {stats.signs} señas, {stats.examples} ejemplos · revisadas por una persona que sabe LSM:{' '}
                  {stats.reviewed} de {stats.signs}
                </dd>
              </>
            )}
            {info.notas && (
              <>
                <dt>Notas</dt>
                <dd>{info.notas}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="muted">No hay ningún paquete oficial guardado todavía.</p>
        )}

        {check.kind === 'available' ? (
          <div className="banner banner--update" role="status">
            <p>
              <strong>Hay una versión nueva (v{check.remote.version})</strong>
              {check.remote.notas && `: ${check.remote.notas}`}
            </p>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => update(check.remote)}>
                Actualizar
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setCheck({ kind: 'idle' })}>
                Más tarde
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={search}
            disabled={check.kind === 'checking' || check.kind === 'downloading'}
          >
            {check.kind === 'checking'
              ? 'Buscando…'
              : check.kind === 'downloading'
                ? `Descargando v${check.remote.version}…`
                : 'Buscar actualizaciones'}
          </button>
        )}
        {check.kind === 'message' && (
          <div className={`banner ${check.ok ? 'banner--ok' : 'banner--error'}`} role="status">
            {check.text}
          </div>
        )}
        <p className="muted small">
          Actualizar el paquete nunca borra ni cambia tus señas personales. El reconocimiento usa las dos.
        </p>
      </section>

      {stats && (
        <section className="card" aria-labelledby="titulo-mis-senas">
          <h2 id="titulo-mis-senas">Mis señas personales</h2>
          <p>
            {stats.personalExamples === 0
              ? 'Todavía no has grabado señas propias.'
              : `Tienes ${stats.personalSigns} ${stats.personalSigns === 1 ? 'seña grabada' : 'señas grabadas'} (${stats.personalExamples} ${stats.personalExamples === 1 ? 'ejemplo' : 'ejemplos'}).`}{' '}
            Se graban, exportan e importan en Señas → Texto › Entrenar.
          </p>
        </section>
      )}

      {teamUnlocked && <TeamTools currentVersion={info?.version ?? 0} currentOrigin={info?.origen ?? ''} />}
    </section>
  );
}
