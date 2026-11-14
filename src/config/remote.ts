// Configuración del paquete oficial de señas en Google Drive.
// TODOS los IDs y la API key van aquí, no repartidos por el código.
//
// Cómo llenarlo (ver también la explicación de la Fase 6):
//   1. Sube lsm-version.json y lsm-senas-vN.json a Google Drive y compártelos como
//      "Cualquier persona con el enlace puede ver".
//   2. El ID de un archivo es la parte larga de su enlace:
//      https://drive.google.com/file/d/ESTE_ES_EL_ID/view
//   3. Crea una API key en Google Cloud, actívale solo la "Google Drive API" y
//      restríngela a los dominios de la app (y a http://localhost:5173 para probar).
//
// Mientras falten estos datos, la app simplemente no busca actualizaciones
// y sigue usando el paquete que ya tiene guardado.

export const REMOTE = {
  /** API key de Google (restringida a la Drive API y a los dominios de la app). */
  apiKey: '',
  /** ID en Google Drive del archivo "<lengua>-version.json", por lengua de señas. */
  versionFileIds: {
    lsm: '',
  } as Record<string, string>,
};

/** ¿Están puestos la API key y el ID del archivo de versión para esta lengua? */
export function isRemoteConfigured(lang: string): boolean {
  return Boolean(REMOTE.apiKey && REMOTE.versionFileIds[lang]);
}

/**
 * Dirección para descargar un archivo de Drive con la API v3.
 * (Los enlaces normales drive.google.com/uc?... no sirven: el navegador los bloquea por CORS.)
 */
export function driveFileUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(REMOTE.apiKey)}`;
}
