// Base de datos local (IndexedDB) usando la librería "idb".
// Todo se guarda en el dispositivo; nada se manda a internet.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type Speaker = 'oyente' | 'sorda';

export interface HistoryEntry {
  id?: number;
  who: Speaker;
  text: string;
  time: number; // fecha en milisegundos
}

/** Un ejemplo grabado de una seña. */
export interface SignSample {
  id?: number;
  /** Lengua de señas (p. ej. "lsm"), para poder tener varias en el futuro. */
  lang: string;
  /** Nombre de la seña: una letra ("A") o una palabra ("hola"). */
  label: string;
  /** "static" = mano quieta (k-NN). "dynamic" = con movimiento (DTW). */
  kind: 'static' | 'dynamic';
  /** 63 números: los 21 puntos de la mano ya normalizados (ver normalize.ts).
   *  En las señas con movimiento es la forma del cuadro del medio. */
  points: number[];
  /** Solo en señas con movimiento: secuencia de cuadros de 65 números (ver motion.ts). */
  frames?: number[][];
  createdAt: number;
  /** Solo en el paquete oficial: true = es la "referencia" (para animar), no un ejemplo para reconocer. */
  reference?: boolean;
  /** Solo en el paquete oficial: si una persona que sabe LSM ya revisó esta seña. */
  reviewed?: boolean;
}

/** Foto o video propio asociado a una seña (se muestra en vez de la mano esqueleto). */
export interface SignMedia {
  /** Clave: "lengua:seña", p. ej. "lsm:A". */
  key: string;
  lang: string;
  label: string;
  type: 'image' | 'video';
  blob: Blob;
  createdAt: number;
}

/** Datos del paquete oficial de señas que hay guardado en el dispositivo. */
export interface OfficialPackageInfo {
  lang: string;
  version: number;
  /** Fecha de publicación del paquete (la que viene en lsm-version.json). */
  fecha: string;
  sha256: string;
  notas: string;
  /** De dónde salen los datos, p. ej. "sintetico" o "grabaciones". */
  origen: string;
  /** "incluido" = venía con la app; "drive" = descargado de Google Drive (Fase 6). */
  fuente: 'incluido' | 'drive';
  /** Cuándo se descargó en este dispositivo (milisegundos). */
  downloadedAt: number;
}

interface AppDB extends DBSchema {
  // Ajustes sueltos (clave → valor), por ejemplo las frases rápidas.
  settings: { key: string; value: unknown };
  // Historial de la conversación.
  history: { key: number; value: HistoryEntry };
  // Ejemplos de señas entrenadas por el usuario (señas PERSONALES).
  signs: { key: number; value: SignSample; indexes: { 'by-lang': string } };
  // Ejemplos del paquete OFICIAL revisado por el equipo (se descarga de Google Drive).
  // Va separado a propósito: actualizar el paquete nunca toca las señas personales.
  official: { key: number; value: SignSample; indexes: { 'by-lang': string } };
  // Fotos y videos propios de cada seña.
  media: { key: string; value: SignMedia; indexes: { 'by-lang': string } };
}

const DB_NAME = 'sin-barreras';
const DB_VERSION = 4; // súbelo cada vez que cambie la estructura

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      // Se ejecuta la primera vez y cada vez que sube DB_VERSION
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('settings');
          db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        }
        if (oldVersion < 2) {
          const signs = db.createObjectStore('signs', { keyPath: 'id', autoIncrement: true });
          signs.createIndex('by-lang', 'lang');
        }
        if (oldVersion < 3) {
          const media = db.createObjectStore('media', { keyPath: 'key' });
          media.createIndex('by-lang', 'lang');
        }
        if (oldVersion < 4) {
          const official = db.createObjectStore('official', { keyPath: 'id', autoIncrement: true });
          official.createIndex('by-lang', 'lang');
        }
      },
    });
  }
  return dbPromise;
}

// ---------- Frases rápidas ----------

export const DEFAULT_PHRASES = [
  'Gracias',
  'No entiendo',
  'Escríbalo por favor',
  'Necesito ayuda',
  '¿Dónde está el baño?',
  'Soy una persona sorda',
  'Más despacio, por favor',
  'Sí',
  'No',
];

export async function getQuickPhrases(): Promise<string[]> {
  const saved = await (await getDB()).get('settings', 'quickPhrases');
  return Array.isArray(saved) ? (saved as string[]) : DEFAULT_PHRASES;
}

export async function saveQuickPhrases(phrases: string[]): Promise<void> {
  await (await getDB()).put('settings', phrases, 'quickPhrases');
}

// ---------- Historial ----------

export async function getHistory(): Promise<HistoryEntry[]> {
  return (await getDB()).getAll('history');
}

/** Guarda un mensaje y lo devuelve con su id. */
export async function addHistory(entry: Omit<HistoryEntry, 'id'>): Promise<HistoryEntry> {
  const id = await (await getDB()).add('history', entry as HistoryEntry);
  return { ...entry, id };
}

export async function clearHistory(): Promise<void> {
  await (await getDB()).clear('history');
}

// ---------- Señas personales (entrenadas por el usuario) ----------

export async function getSignSamples(lang: string): Promise<SignSample[]> {
  return (await getDB()).getAllFromIndex('signs', 'by-lang', lang);
}

export async function addSignSample(sample: Omit<SignSample, 'id'>): Promise<SignSample> {
  const id = await (await getDB()).add('signs', sample as SignSample);
  return { ...sample, id };
}

/** Borra todos los ejemplos de una seña. */
export async function deleteSign(lang: string, label: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('signs', 'readwrite');
  for (const s of await tx.store.index('by-lang').getAll(lang)) {
    if (s.label === label && s.id !== undefined) await tx.store.delete(s.id);
  }
  await tx.done;
}

// ---------- Paquete oficial ----------

const packageInfoKey = (lang: string) => `officialPackage:${lang}`;

export async function getOfficialSamples(lang: string): Promise<SignSample[]> {
  return (await getDB()).getAllFromIndex('official', 'by-lang', lang);
}

/** Versión del paquete oficial guardado, o null si nunca se ha descargado uno. */
export async function getOfficialPackageInfo(lang: string): Promise<OfficialPackageInfo | null> {
  const info = await (await getDB()).get('settings', packageInfoKey(lang));
  return (info as OfficialPackageInfo | undefined) ?? null;
}

/**
 * Reemplaza el paquete oficial por uno nuevo (ya verificado y validado).
 * Todo ocurre en UNA sola transacción: si algo falla a la mitad, IndexedDB deshace
 * todo y se conserva el paquete anterior con su versión. Las señas personales no se tocan.
 */
export async function replaceOfficialPackage(
  info: OfficialPackageInfo,
  samples: Omit<SignSample, 'id' | 'lang'>[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['official', 'settings'], 'readwrite');
  const store = tx.objectStore('official');
  for (const old of await store.index('by-lang').getAllKeys(info.lang)) await store.delete(old);
  for (const s of samples) await store.add({ ...s, lang: info.lang } as SignSample);
  // La versión se guarda al final, dentro de la misma transacción
  await tx.objectStore('settings').put(info, packageInfoKey(info.lang));
  await tx.done;
}

// ---------- Fotos y videos propios ----------

function mediaKey(lang: string, label: string): string {
  return `${lang}:${label}`;
}

export async function getAllMedia(lang: string): Promise<SignMedia[]> {
  return (await getDB()).getAllFromIndex('media', 'by-lang', lang);
}

export async function saveMedia(lang: string, label: string, blob: Blob): Promise<SignMedia> {
  const media: SignMedia = {
    key: mediaKey(lang, label),
    lang,
    label,
    type: blob.type.startsWith('video') ? 'video' : 'image',
    blob,
    createdAt: Date.now(),
  };
  await (await getDB()).put('media', media);
  return media;
}

export async function deleteMedia(lang: string, label: string): Promise<void> {
  await (await getDB()).delete('media', mediaKey(lang, label));
}