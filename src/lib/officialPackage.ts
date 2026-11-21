// Paquete oficial de señas en formato "mediapipe-hand-21".
//
// El archivo (p. ej. public/signs/lsm-senas-v1.json) trae, por cada seña:
//   - "referencia": una pose (o una secuencia de poses si lleva movimiento) para ANIMAR (modo 2).
//   - "ejemplos": varias poses/secuencias para ENTRENAR el reconocimiento (modo 3).
// Cada pose son 21 puntos [x, y, z] de MediaPipe en coordenadas de la imagen.
//
// Aquí convertimos esos puntos al mismo formato normalizado que usan las señas que
// graba el usuario (ver normalize.ts y motion.ts), para que las dos fuentes se puedan
// comparar entre sí. La Fase 6 usará este mismo lector para el paquete de Google Drive.

import type { SignLanguageConfig } from '../config/language';
import { getOfficialPackageInfo, replaceOfficialPackage, type OfficialPackageInfo, type SignSample } from './db';
import type { HandFrame } from './hands';
import { MOTION_WEIGHT, toSequence, trimStill } from './motion';
import { handGeometry, normalizeHand, type Landmark } from './normalize';

export const PACKAGE_FORMAT = 'mediapipe-hand-21';

/** Orden de los 21 puntos que esperamos (el mismo de MediaPipe). */
export const POINT_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
];

/**
 * Proporción (ancho / alto) de las coordenadas del paquete. Medido en el archivo v1:
 * los dedos miden lo mismo apunten hacia arriba o de lado solo con proporción 1:1.
 */
const PACKAGE_ASPECT = 1;

/**
 * ¿Hay que reflejar una mano DERECHA del paquete para compararla con la cámara?
 *
 * MediaPipe decide "izquierda/derecha" suponiendo que la imagen está en espejo (selfie).
 * La app le pasa la imagen de la cámara SIN espejo, así que una mano derecha real sale
 * etiquetada como "Left" y normalize.ts la refleja. El paquete dice "mano derecha, imagen
 * sin espejo", así que para que coincida con lo que ve la cámara también se refleja.
 * Si con datos reales la mano derecha no se reconoce pero la izquierda sí, cambia esto a false.
 */
const MIRROR_RIGHT_HAND = true;

// ---------- Estructura del archivo ----------

interface PackageSign {
  etiqueta: string;
  tipo: 'estatica' | 'dinamica';
  categoria?: string;
  mano?: 'derecha' | 'izquierda';
  revisado?: boolean;
  referencia: unknown;
  ejemplos: unknown;
}

interface PackageFile {
  formato: string;
  lengua: string;
  version: number;
  fecha: string;
  origen?: string;
  nota?: string;
  puntos?: string[];
  senas: PackageSign[];
}

export interface ParsedPackage {
  info: Omit<OfficialPackageInfo, 'sha256' | 'downloadedAt' | 'fuente'>;
  samples: Omit<SignSample, 'id' | 'lang'>[];
  /** Señas que tenían errores y se descartaron. */
  skipped: string[];
}

// ---------- Conversión ----------

/** Revisa que sean 21 puntos [x, y, z] con números válidos. */
function toLandmarks(raw: unknown): Landmark[] | null {
  if (!Array.isArray(raw) || raw.length !== 21) return null;
  const points: Landmark[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    points.push({ x: p[0], y: p[1], z: p[2] });
  }
  return points;
}

/** Convierte una pose del paquete en un "cuadro" igual a los que produce la cámara. */
function toFrame(landmarks: Landmark[], mirror: boolean, time: number): HandFrame | null {
  const vector = normalizeHand(landmarks, mirror, PACKAGE_ASPECT);
  if (!vector) return null;
  const { wrist, size } = handGeometry(landmarks, mirror, PACKAGE_ASPECT);
  return { vector, wrist, size, handedness: mirror ? 'Left' : 'Right', time };
}

/** Seña quieta: una pose → 63 números. */
function staticPoints(raw: unknown, mirror: boolean): number[] | null {
  const landmarks = toLandmarks(raw);
  return landmarks ? (toFrame(landmarks, mirror, 0)?.vector ?? null) : null;
}

/** Seña con movimiento: varias poses → secuencia de 65 números por cuadro. */
function dynamicFrames(raw: unknown, mirror: boolean): { points: number[]; frames: number[][] } | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 300) return null;
  const frames: HandFrame[] = [];
  for (let i = 0; i < raw.length; i++) {
    const landmarks = toLandmarks(raw[i]);
    const frame = landmarks && toFrame(landmarks, mirror, i);
    if (!frame) return null;
    frames.push(frame);
  }
  // Igual que al grabar: quitamos la parte quieta del principio y del final
  const moving = trimStill(frames) ?? frames;
  return { points: moving[Math.floor(moving.length / 2)].vector, frames: toSequence(moving) };
}

/** "a" → "A", "ll" → "LL"; las palabras quedan en minúsculas. */
function labelFor(etiqueta: string, lang: SignLanguageConfig): string {
  const upper = etiqueta.trim().toUpperCase();
  return lang.alphabet.includes(upper) ? upper : etiqueta.trim().toLowerCase();
}

/**
 * Lee un paquete en formato mediapipe-hand-21 y lo convierte al formato de la app.
 * Lanza un error con un mensaje sencillo si el archivo no sirve.
 */
export function parseMediapipePackage(data: unknown, lang: SignLanguageConfig): ParsedPackage {
  const pack = data as Partial<PackageFile> | null;
  if (!pack || pack.formato !== PACKAGE_FORMAT || !Array.isArray(pack.senas)) {
    throw new Error(`El paquete no está en formato ${PACKAGE_FORMAT}.`);
  }
  if (typeof pack.lengua !== 'string' || pack.lengua.toLowerCase() !== lang.id) {
    throw new Error(`El paquete es de otra lengua de señas (${pack.lengua}).`);
  }
  if (typeof pack.version !== 'number') throw new Error('El paquete no indica su versión.');
  if (pack.puntos && pack.puntos.join() !== POINT_NAMES.join()) {
    throw new Error('Los puntos de la mano del paquete vienen en otro orden.');
  }

  const baseTime = Date.parse(pack.fecha ?? '') || 0;
  const samples: ParsedPackage['samples'] = [];
  const skipped: string[] = [];

  pack.senas.forEach((sign, signIndex) => {
    if (!sign || typeof sign.etiqueta !== 'string' || !sign.etiqueta.trim() || !Array.isArray(sign.ejemplos)) {
      skipped.push(String(sign?.etiqueta ?? `#${signIndex + 1}`));
      return;
    }
    const label = labelFor(sign.etiqueta, lang);
    const mirror = (sign.mano ?? 'derecha') === 'derecha' ? MIRROR_RIGHT_HAND : !MIRROR_RIGHT_HAND;
    const reviewed = sign.revisado === true;
    const converted: ParsedPackage['samples'] = [];

    const add = (raw: unknown, reference: boolean, n: number) => {
      const createdAt = baseTime + signIndex * 1000 + n; // fecha estable por ejemplo
      if (sign.tipo === 'dinamica') {
        const d = dynamicFrames(raw, mirror);
        if (d) converted.push({ label, kind: 'dynamic', ...d, createdAt, reference, reviewed });
        return Boolean(d);
      }
      const points = staticPoints(raw, mirror);
      if (points) converted.push({ label, kind: 'static', points, createdAt, reference, reviewed });
      return Boolean(points);
    };

    const refOk = add(sign.referencia, true, 0);
    let examplesOk = 0;
    (sign.ejemplos as unknown[]).forEach((ex, i) => add(ex, false, i + 1) && examplesOk++);

    // Si la referencia o todos los ejemplos están mal, descartamos la seña completa
    if (!refOk || examplesOk === 0) skipped.push(label);
    else samples.push(...converted);
  });

  return {
    info: {
      lang: lang.id,
      version: pack.version,
      fecha: pack.fecha ?? '',
      notas: pack.nota ?? '',
      origen: pack.origen ?? '',
    },
    samples,
    skipped,
  };
}

// ---------- Instalación del paquete incluido con la app ----------

/**
 * Huella sha256 (para verificar que un archivo llegó completo y sin cambios).
 * Se calcula sobre los bytes exactos del archivo.
 */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  if (!crypto?.subtle) return ''; // solo existe en https o localhost
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const installing = new Map<string, Promise<void>>();

/**
 * Instala el paquete que viene con la app si todavía no hay ninguno guardado
 * (o si el incluido es más nuevo). Nunca bloquea la app: si falla, sigue sin él.
 */
export function ensureBundledPackage(lang: SignLanguageConfig): Promise<void> {
  const bundled = lang.bundledPackage;
  if (!bundled) return Promise.resolve();

  let promise = installing.get(lang.id);
  if (!promise) {
    promise = (async () => {
      try {
        const current = await getOfficialPackageInfo(lang.id);
        if (current && current.version >= bundled.version) return; // ya está al día

        const res = await fetch(new URL(bundled.file, document.baseURI).href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseMediapipePackage(JSON.parse(text), lang);
        if (parsed.samples.length === 0) throw new Error('El paquete no tiene señas válidas.');

        // Revisamos de nuevo justo antes de guardar: si mientras tanto se descargó
        // un paquete más nuevo de Google Drive, no lo pisamos con el incluido.
        const latest = await getOfficialPackageInfo(lang.id);
        if (latest && latest.version >= parsed.info.version) return;
        await replaceOfficialPackage(
          { ...parsed.info, sha256: await sha256Hex(text), downloadedAt: Date.now(), fuente: 'incluido' },
          parsed.samples,
        );
        if (parsed.skipped.length) console.warn('Señas del paquete con errores:', parsed.skipped);
      } catch (err) {
        console.warn('No se pudo instalar el paquete oficial incluido:', err);
        installing.delete(lang.id); // permitir reintentar más tarde
      }
    })();
    installing.set(lang.id, promise);
  }
  return promise;
}

// ---------- Conversión inversa (para "Generar paquete") ----------
// Convierte los datos normalizados de la app otra vez a coordenadas de imagen del
// formato mediapipe-hand-21 ("mano derecha, imagen sin espejo"). Al volver a leer el
// paquete con parseMediapipePackage se obtienen los mismos datos normalizados.

const OUT_CENTER = { x: 0.5, y: 0.6 }; // dónde se coloca la muñeca en la "imagen"
const OUT_SCALE = 0.2; // tamaño de la palma en la "imagen"
const round = (n: number) => Math.round(n * 10000) / 10000;

/** Puntos normalizados (63 números) → 21 puntos [x, y, z] del paquete. */
export function toPackagePose(vector: number[], wrist = OUT_CENTER): number[][] {
  const flip = MIRROR_RIGHT_HAND ? -1 : 1; // deshacer el reflejo que hace normalizeHand
  const out: number[][] = [];
  for (let i = 0; i < 63; i += 3) {
    out.push([
      round(wrist.x + (vector[i] * flip * OUT_SCALE) / PACKAGE_ASPECT),
      round(wrist.y + vector[i + 1] * OUT_SCALE),
      round((vector[i + 2] * OUT_SCALE) / PACKAGE_ASPECT),
    ]);
  }
  return out;
}

/** Secuencia de la app (65 números por cuadro) → lista de poses del paquete. */
export function toPackageSequence(frames: number[][]): number[][][] {
  const flip = MIRROR_RIGHT_HAND ? -1 : 1;
  return frames.map((f) =>
    toPackagePose(f, {
      x: OUT_CENTER.x + ((f[63] / MOTION_WEIGHT) * flip * OUT_SCALE) / PACKAGE_ASPECT,
      y: OUT_CENTER.y + (f[64] / MOTION_WEIGHT) * OUT_SCALE,
    }),
  );
}