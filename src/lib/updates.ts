// Actualizaciones del paquete oficial de señas desde Google Drive.
//
// Flujo (ver CLAUDE.md):
//   1. Sin internet → no se hace nada; se usa el paquete guardado.
//   2. Con internet → se descarga solo el archivo pequeño "<lengua>-version.json".
//   3. Si la versión es la misma → nada.
//   4. Si hay una más nueva (o no hay ningún paquete) → se pregunta al usuario.
//   5. Al descargar: se verifica el sha256, se valida el JSON y se guarda TODO de una vez.
//      Si algo falla, se conserva el paquete anterior.

import type { SignLanguageConfig } from '../config/language';
import { driveFileUrl, isRemoteConfigured, REMOTE } from '../config/remote';
import { getOfficialPackageInfo, replaceOfficialPackage, type OfficialPackageInfo } from './db';
import { ensureBundledPackage, parseMediapipePackage, sha256Hex } from './officialPackage';
import { notifySignsChanged } from './signData';

/** Contenido de "<lengua>-version.json". */
export interface RemoteVersion {
  version: number;
  fecha: string;
  /** ID en Google Drive del archivo del paquete. */
  archivo: string;
  sha256: string;
  notas: string;
}

export type UpdateCheck =
  | { status: 'not-configured' }
  | { status: 'offline' }
  | { status: 'up-to-date'; current: OfficialPackageInfo | null; remote: RemoteVersion }
  | { status: 'available'; current: OfficialPackageInfo | null; remote: RemoteVersion };

/** Descarga con tiempo límite, para no quedarse esperando para siempre. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Google Drive tardó demasiado en responder.');
    throw new Error('No hay conexión con Google Drive.', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** Mensaje sencillo según el error de Google Drive. */
function httpError(status: number): Error {
  if (status === 400 || status === 403) {
    return new Error(
      'Google Drive no permitió la descarga. Revisa que el archivo esté compartido como "Cualquier persona con el enlace" y que la API key sea correcta.',
    );
  }
  if (status === 404) return new Error('No se encontró el archivo en Google Drive. Revisa el ID en src/config/remote.ts.');
  return new Error(`Google Drive respondió con un error (${status}).`);
}

/** Revisa que el archivo de versión tenga el formato correcto. */
function parseRemoteVersion(data: unknown): RemoteVersion {
  const v = data as Partial<RemoteVersion> | null;
  if (
    !v ||
    typeof v.version !== 'number' ||
    !Number.isInteger(v.version) ||
    v.version < 1 ||
    typeof v.archivo !== 'string' ||
    !/^[\w-]{10,}$/.test(v.archivo) ||
    typeof v.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(v.sha256)
  ) {
    throw new Error('El archivo de versión de Google Drive no tiene el formato correcto.');
  }
  return {
    version: v.version,
    fecha: typeof v.fecha === 'string' ? v.fecha : '',
    archivo: v.archivo,
    sha256: v.sha256.toLowerCase(),
    notas: typeof v.notas === 'string' ? v.notas : '',
  };
}

/** Pregunta a Google Drive qué versión del paquete hay publicada. */
export async function checkForUpdate(lang: SignLanguageConfig): Promise<UpdateCheck> {
  if (!isRemoteConfigured(lang.id)) return { status: 'not-configured' };
  if (!navigator.onLine) return { status: 'offline' };

  // Primero nos aseguramos de tener instalado el paquete que viene con la app
  await ensureBundledPackage(lang);
  const current = await getOfficialPackageInfo(lang.id);

  const res = await fetchWithTimeout(driveFileUrl(REMOTE.versionFileIds[lang.id]), 15000);
  if (!res.ok) throw httpError(res.status);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('El archivo de versión de Google Drive no es un JSON válido.');
  }
  const remote = parseRemoteVersion(data);

  const newer = !current || remote.version > current.version;
  return { status: newer ? 'available' : 'up-to-date', current, remote };
}

export interface InstallResult {
  version: number;
  signs: number;
  skipped: string[];
}

/**
 * Descarga el paquete, lo verifica y lo guarda.
 * Si algo falla lanza un error y el paquete anterior queda intacto.
 */
export async function downloadAndInstall(lang: SignLanguageConfig, remote: RemoteVersion): Promise<InstallResult> {
  const res = await fetchWithTimeout(driveFileUrl(remote.archivo), 120000);
  if (!res.ok) throw httpError(res.status);
  const bytes = await res.arrayBuffer();

  // 1. ¿Llegó completo y sin cambios? (comparamos la huella sha256)
  const hash = await sha256Hex(bytes);
  if (!hash) throw new Error('Este navegador no puede verificar el archivo (se necesita https).');
  if (hash !== remote.sha256) {
    throw new Error('El archivo descargado no coincide con el esperado (sha256). Puede estar incompleto o dañado.');
  }

  // 2. ¿Tiene la estructura correcta?
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('El paquete descargado no es un JSON válido.');
  }
  const parsed = parseMediapipePackage(data, lang);
  if (parsed.info.version !== remote.version) {
    throw new Error(
      `La versión dentro del paquete (v${parsed.info.version}) no coincide con la del archivo de versión (v${remote.version}).`,
    );
  }
  if (parsed.samples.length === 0) throw new Error('El paquete descargado no tiene señas válidas.');

  // 3. Guardar todo de una vez (si falla, IndexedDB deshace y queda el paquete anterior)
  await replaceOfficialPackage(
    {
      ...parsed.info,
      fecha: remote.fecha || parsed.info.fecha,
      notas: remote.notas || parsed.info.notas,
      sha256: hash,
      downloadedAt: Date.now(),
      fuente: 'drive',
    },
    parsed.samples,
  );
  notifySignsChanged();

  return {
    version: parsed.info.version,
    signs: new Set(parsed.samples.map((s) => s.label)).size,
    skipped: parsed.skipped,
  };
}

// ---------- "Más tarde": no volver a preguntar en esta sesión ----------

const DISMISS_KEY = 'sin-barreras:actualizacion-mas-tarde';

export function dismissForSession(version: number): void {
  sessionStorage.setItem(DISMISS_KEY, String(version));
}

export function isDismissedForSession(version: number): boolean {
  return sessionStorage.getItem(DISMISS_KEY) === String(version);
}
