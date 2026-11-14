// "Generar paquete": herramienta del equipo para crear una nueva versión del paquete oficial.
//
// Toma las señas elegidas (personales y/o del paquete actual) y produce dos archivos
// listos para subir a Google Drive:
//   - <lengua>-senas-vN.json   → el paquete, en formato mediapipe-hand-21
//   - <lengua>-version.json    → versión, fecha, ID del paquete en Drive, sha256 y notas

import type { SignLanguageConfig } from '../config/language';
import type { SignSample } from './db';
import { resample } from './motion';
import { PACKAGE_FORMAT, POINT_NAMES, sha256Hex, toPackagePose, toPackageSequence } from './officialPackage';
import { representativePose, representativeSequence } from './signs';

/** Cuadros por seña con movimiento en el paquete (igual que en el paquete v1). */
const FRAMES_PER_DYNAMIC = 15;
/** Máximo de ejemplos por seña, para que el archivo no crezca demasiado. */
const MAX_EXAMPLES = 40;

export interface SignSelection {
  label: string;
  /** Ejemplos de esta seña que se incluirán (de cualquier fuente). */
  examples: SignSample[];
  /** ¿Una persona que sabe LSM ya revisó esta seña? */
  reviewed: boolean;
}

export interface PackageOptions {
  lang: SignLanguageConfig;
  version: number;
  fecha: string;
  origen: string;
  notas: string;
  signs: SignSelection[];
}

export interface BuiltPackage {
  fileName: string;
  /** Bytes exactos del archivo (la huella sha256 se calcula sobre estos mismos bytes). */
  bytes: Uint8Array;
  sha256: string;
  signCount: number;
  exampleCount: number;
}

/** Elige ejemplos repartidos de forma pareja si hay demasiados. */
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

export async function buildPackage(opts: PackageOptions): Promise<BuiltPackage> {
  const { lang } = opts;
  let exampleCount = 0;

  const senas = opts.signs
    .filter((s) => s.examples.length > 0)
    .map((sign) => {
      // Si hay ejemplos con movimiento, la seña se publica como "dinamica"
      const dynamic = sign.examples.filter((e) => e.kind === 'dynamic' && e.frames);
      const isDynamic = dynamic.length > 0;
      const chosen = spread(isDynamic ? dynamic : sign.examples.filter((e) => e.kind === 'static'), MAX_EXAMPLES);
      exampleCount += chosen.length;

      const isLetter = lang.alphabet.includes(sign.label);
      const base = {
        etiqueta: isLetter ? sign.label.toLowerCase() : sign.label,
        tipo: isDynamic ? 'dinamica' : 'estatica',
        categoria: isLetter ? 'alfabeto' : 'palabra',
        mano: 'derecha',
        revisado: sign.reviewed,
      };

      if (isDynamic) {
        const seqs = chosen.map((e) => resample(e.frames!, FRAMES_PER_DYNAMIC));
        return {
          ...base,
          referencia: toPackageSequence(representativeSequence(seqs)),
          ejemplos: seqs.map(toPackageSequence),
        };
      }
      const poses = chosen.map((e) => e.points);
      return { ...base, referencia: toPackagePose(representativePose(poses)), ejemplos: poses.map((p) => toPackagePose(p)) };
    });

  const pack = {
    formato: PACKAGE_FORMAT,
    lengua: lang.id.toUpperCase(),
    version: opts.version,
    fecha: opts.fecha,
    origen: opts.origen,
    nota: opts.notas,
    coordenadas:
      'x,y normalizadas a la imagen (0..1, y hacia abajo); z relativa a la muñeca (negativo = hacia la cámara). Mano derecha, imagen sin espejo.',
    puntos: POINT_NAMES,
    cuadros_por_dinamica: FRAMES_PER_DYNAMIC,
    senas,
  };

  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  return {
    fileName: `${lang.id}-senas-v${opts.version}.json`,
    bytes,
    sha256: await sha256Hex(bytes),
    signCount: senas.length,
    exampleCount,
  };
}

/** Contenido del archivo de versión que acompaña al paquete. */
export function buildVersionFile(built: BuiltPackage, opts: Pick<PackageOptions, 'version' | 'fecha' | 'notas'>, driveId: string) {
  return {
    version: opts.version,
    fecha: opts.fecha,
    archivo: driveId.trim() || 'PEGAR_AQUI_EL_ID_DEL_PAQUETE_EN_DRIVE',
    sha256: built.sha256,
    notas: opts.notas,
  };
}

/** Descarga bytes como archivo. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
