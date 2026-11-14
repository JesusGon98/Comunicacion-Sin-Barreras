// Punto único para leer TODAS las señas que conoce la app.
//
// Hay dos fuentes, guardadas por separado en IndexedDB:
//   - "personal": las que entrena cada usuario en Señas → Texto › Entrenar.
//   - "official": el paquete revisado por el equipo (viene con la app y, en la
//     Fase 6, se actualizará desde Google Drive).
// El reconocimiento y Texto → Señas usan las dos. Así, cuando cambie el paquete
// oficial, no hay que tocar esas pantallas: solo cambia el almacén "official".

import { currentLanguage } from '../config/language';
import { getOfficialPackageInfo, getOfficialSamples, getSignSamples, type OfficialPackageInfo, type SignSample } from './db';
import { ensureBundledPackage } from './officialPackage';

export type SignSource = 'personal' | 'official';

export interface SourcedSample extends SignSample {
  source: SignSource;
}

export interface LoadedSamples {
  personal: SourcedSample[];
  /** Todo el paquete oficial (referencias + ejemplos). */
  official: SourcedSample[];
  /** Ejemplos para RECONOCER: los personales + los "ejemplos" del paquete (sin las referencias). */
  recognition: SourcedSample[];
  /** Datos del paquete oficial guardado (o null si no hay). */
  packageInfo: OfficialPackageInfo | null;
}

// ---------- Aviso de "las señas cambiaron" ----------
// Cuando se instala un paquete nuevo, las pantallas abiertas vuelven a cargar las señas.

const SIGNS_CHANGED = 'sin-barreras:senas-cambiaron';

export function notifySignsChanged(): void {
  window.dispatchEvent(new Event(SIGNS_CHANGED));
}

/** Llama a "callback" cada vez que cambien las señas. Devuelve la función para dejar de escuchar. */
export function onSignsChanged(callback: () => void): () => void {
  window.addEventListener(SIGNS_CHANGED, callback);
  return () => window.removeEventListener(SIGNS_CHANGED, callback);
}

export async function loadAllSamples(lang: string): Promise<LoadedSamples> {
  // La primera vez, esperamos a que se instale el paquete incluido con la app
  if (lang === currentLanguage.id) await ensureBundledPackage(currentLanguage);

  const [personal, official, packageInfo] = await Promise.all([
    getSignSamples(lang),
    getOfficialSamples(lang),
    getOfficialPackageInfo(lang),
  ]);
  const p = personal.map((s) => ({ ...s, source: 'personal' as const }));
  const o = official.map((s) => ({ ...s, source: 'official' as const }));
  return { personal: p, official: o, recognition: [...p, ...o.filter((s) => !s.reference)], packageInfo };
}

/**
 * Para MOSTRAR una seña (mano animada) elegimos una sola fuente por seña:
 *   1. Si el usuario grabó la suya, se usa la suya.
 *   2. Si no, la "referencia" del paquete oficial.
 *   3. Si el paquete no trae referencia de esa seña, sus ejemplos.
 */
export function samplesForDisplay(loaded: LoadedSamples): SourcedSample[] {
  const personalLabels = new Set(loaded.personal.map((s) => s.label));
  const referenceLabels = new Set(loaded.official.filter((s) => s.reference).map((s) => s.label));
  const official = loaded.official.filter(
    (s) => !personalLabels.has(s.label) && (s.reference || !referenceLabels.has(s.label)),
  );
  return [...loaded.personal, ...official];
}
