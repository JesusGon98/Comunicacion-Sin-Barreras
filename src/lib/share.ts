// Exportar e importar las señas entrenadas como archivo .json,
// para compartirlas entre dispositivos y personas.
//
// El formato del archivo (SignFile) y su validación (readSignFile) son los mismos
// que usará el paquete oficial de Google Drive, para no tener dos formatos distintos.

import { addSignSample, getAllMedia, getSignSamples, saveMedia, type SignSample } from './db';

const APP_ID = 'comunicacion-sin-barreras';
const FORMAT_VERSION = 1;

/** Un ejemplo de seña tal como va dentro del archivo .json. */
export interface FileSample {
  label: string;
  kind: 'static' | 'dynamic';
  points: number[];
  frames?: number[][];
  createdAt: number;
}

interface FileMedia {
  label: string;
  /** Archivo convertido a texto ("data URL"). */
  data: string;
}

/** Estructura del archivo de señas (.json). */
export interface SignFile {
  app: string;
  format: number;
  lang: string;
  exportedAt: string;
  samples: FileSample[];
  media?: FileMedia[];
}

/** Crea el contenido del archivo a partir de ejemplos guardados. */
export function buildSignFile(lang: string, samples: SignSample[]): SignFile {
  return {
    app: APP_ID,
    format: FORMAT_VERSION,
    lang,
    exportedAt: new Date().toISOString(),
    samples: samples.map(({ label, kind, points, frames, createdAt }) => ({ label, kind, points, frames, createdAt })),
  };
}

// ---------- Validación (no confiamos en archivos ajenos) ----------

const isNumberArray = (v: unknown, length: number): v is number[] =>
  Array.isArray(v) && v.length === length && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function isValidSample(s: unknown): s is FileSample {
  if (!s || typeof s !== 'object') return false;
  const x = s as Record<string, unknown>;
  if (typeof x.label !== 'string' || !x.label.trim() || x.label.length > 60) return false;
  if (x.kind !== 'static' && x.kind !== 'dynamic') return false;
  if (!isNumberArray(x.points, 63)) return false;
  if (x.kind === 'dynamic') {
    if (!Array.isArray(x.frames) || x.frames.length < 2 || x.frames.length > 300) return false;
    if (!x.frames.every((f) => isNumberArray(f, 65))) return false;
  }
  return true;
}

export interface ReadResult {
  /** Ejemplos válidos, ya limpios. */
  samples: FileSample[];
  /** Cuántos ejemplos tenían errores y se descartaron. */
  invalid: number;
  media: FileMedia[];
}

/**
 * Revisa que el contenido de un archivo de señas sea correcto y devuelve solo lo válido.
 * Lanza un error con un mensaje sencillo si el archivo no sirve.
 */
export function readSignFile(data: unknown, lang: string): ReadResult {
  const file = data as Partial<SignFile> | null;
  if (!file || file.app !== APP_ID || !Array.isArray(file.samples)) {
    throw new Error('Este archivo no es de señas de esta app.');
  }
  if (typeof file.format !== 'number' || file.format > FORMAT_VERSION) {
    throw new Error('El archivo es de una versión más nueva de la app. Actualiza la app e intenta de nuevo.');
  }
  if (file.lang !== lang) {
    throw new Error(`El archivo es de otra lengua de señas (${file.lang}).`);
  }

  const samples: FileSample[] = [];
  let invalid = 0;
  for (const s of file.samples) {
    if (!isValidSample(s)) {
      invalid++;
      continue;
    }
    const clean: FileSample = {
      label: s.label.trim(),
      kind: s.kind,
      points: s.points,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    };
    if (s.kind === 'dynamic') clean.frames = s.frames;
    samples.push(clean);
  }

  // Fotos y videos: solo si son imágenes o videos de verdad
  const media = (Array.isArray(file.media) ? file.media : []).filter(
    (m): m is FileMedia =>
      typeof m?.label === 'string' && typeof m?.data === 'string' && /^data:(image|video)\//.test(m.data),
  );

  return { samples, invalid, media };
}

// ---------- Exportar ----------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Descarga un objeto como archivo .json. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Crea el archivo .json con las señas PERSONALES (y opcionalmente fotos y videos) y lo descarga. */
export async function exportSigns(lang: string, includeMedia: boolean): Promise<number> {
  const samples = await getSignSamples(lang);
  const file = buildSignFile(lang, samples);
  if (includeMedia) {
    const media = await getAllMedia(lang);
    file.media = await Promise.all(media.map(async (m) => ({ label: m.label, data: await blobToDataUrl(m.blob) })));
  }
  downloadJson(file, `senas-${lang}-${new Date().toISOString().slice(0, 10)}.json`);
  return samples.length;
}

// ---------- Importar ----------

export interface ImportResult {
  added: number;
  skipped: number;
  invalid: number;
  media: number;
}

/** Lee un archivo .json exportado y agrega sus señas a las señas PERSONALES. */
export async function importSigns(file: File, lang: string): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no es un .json válido.');
  }
  const { samples, invalid, media } = readSignFile(data, lang);

  // Para no duplicar: un ejemplo con el mismo nombre y la misma fecha ya existe
  const existing = new Set((await getSignSamples(lang)).map((s) => `${s.label}|${s.createdAt}`));
  const result: ImportResult = { added: 0, skipped: 0, invalid, media: 0 };

  for (const s of samples) {
    const key = `${s.label}|${s.createdAt}`;
    if (existing.has(key)) {
      result.skipped++;
      continue;
    }
    await addSignSample({ ...s, lang });
    existing.add(key);
    result.added++;
  }

  for (const m of media) {
    const blob = await (await fetch(m.data)).blob();
    await saveMedia(lang, m.label, blob);
    result.media++;
  }

  return result;
}
