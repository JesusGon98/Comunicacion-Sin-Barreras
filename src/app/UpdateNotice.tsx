import { useEffect, useState } from 'react';
import { currentLanguage } from '../config/language';
import type { OfficialPackageInfo } from '../lib/db';
import { vibrate } from '../lib/speech';
import {
  checkForUpdate,
  dismissForSession,
  downloadAndInstall,
  isDismissedForSession,
  type RemoteVersion,
} from '../lib/updates';

type State =
  | { kind: 'hidden' }
  | { kind: 'available'; remote: RemoteVersion; current: OfficialPackageInfo | null }
  | { kind: 'downloading'; remote: RemoteVersion }
  | { kind: 'done'; version: number; signs: number }
  | { kind: 'error'; message: string; current: OfficialPackageInfo | null };

// Al abrir la app, revisa si hay un paquete de señas más nuevo en Google Drive.
// Sin internet (o si algo falla al revisar) no muestra nada: la app nunca se bloquea.
export function UpdateNotice() {
  const [state, setState] = useState<State>({ kind: 'hidden' });

  useEffect(() => {
    let cancelled = false;
    checkForUpdate(currentLanguage)
      .then((result) => {
        if (cancelled || result.status !== 'available' || isDismissedForSession(result.remote.version)) return;
        setState({ kind: 'available', remote: result.remote, current: result.current });
        vibrate(80);
      })
      .catch(() => {
        /* Al abrir la app, los errores de red se ignoran en silencio */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // El mensaje de éxito se cierra solo
  useEffect(() => {
    if (state.kind !== 'done') return;
    const id = setTimeout(() => setState({ kind: 'hidden' }), 8000);
    return () => clearTimeout(id);
  }, [state.kind]);

  if (state.kind === 'hidden') return null;

  const update = async (remote: RemoteVersion, current: OfficialPackageInfo | null) => {
    setState({ kind: 'downloading', remote });
    try {
      const r = await downloadAndInstall(currentLanguage, remote);
      setState({ kind: 'done', version: r.version, signs: r.signs });
      vibrate([80, 60, 80]);
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Error desconocido.', current });
      vibrate([100, 60, 100]);
    }
  };

  const later = (remote: RemoteVersion) => {
    dismissForSession(remote.version); // no volver a preguntar en esta sesión
    setState({ kind: 'hidden' });
  };

  if (state.kind === 'available') {
    const { remote, current } = state;
    return (
      <div className="banner banner--update" role="alert">
        {current ? (
          <p>
            <strong>Hay una actualización de señas (v{remote.version})</strong>
            {remote.notas && `: ${remote.notas}`}. ¿Descargar ahora?
          </p>
        ) : (
          <p>
            <strong>Todavía no tienes el paquete oficial de señas (v{remote.version}).</strong> Sin él, el reconocimiento
            casi no funciona: te recomendamos descargarlo ahora.
            {remote.notas && ` ${remote.notas}`}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => update(remote, current)}>
            Actualizar
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => later(remote)}>
            Más tarde
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'downloading') {
    return (
      <div className="banner banner--update" role="status">
        <p>Descargando las señas v{state.remote.version}… La app se puede seguir usando mientras tanto.</p>
      </div>
    );
  }

  if (state.kind === 'done') {
    return (
      <div className="banner banner--ok" role="status">
        <p>
          ✓ Señas actualizadas a la versión {state.version} ({state.signs} señas).
        </p>
        <button type="button" className="btn btn--small" onClick={() => setState({ kind: 'hidden' })}>
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="banner banner--error" role="alert">
      <p>
        No se pudo actualizar el paquete de señas. {state.message}{' '}
        {state.current ? `Se conserva el paquete anterior (v${state.current.version}).` : ''}
      </p>
      <button type="button" className="btn btn--small" onClick={() => setState({ kind: 'hidden' })}>
        Cerrar
      </button>
    </div>
  );
}
