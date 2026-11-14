// Clasificadores de señas.
//
// 1) Señas estáticas → k-NN ("k vecinos más cercanos").
//    Guardamos muchos ejemplos de cada seña. Para reconocer una mano nueva,
//    buscamos los k ejemplos más parecidos y vemos a qué seña pertenecen la mayoría.
//
// 2) Señas con movimiento → DTW ("Dynamic Time Warping").
//    Compara dos secuencias de cuadros aunque una se haya hecho más rápido o más
//    lento que la otra: "estira" el tiempo para alinearlas antes de medir la diferencia.
//    Luego se usa la misma votación de vecinos que en k-NN.
//
// Para ser honestos, si la seña no se parece lo suficiente a NINGÚN ejemplo,
// la confianza es 0 y la app no muestra nada (no inventa una traducción).

import { resample } from './motion';

export interface Prediction {
  label: string;
  /** De 0 a 1. */
  confidence: number;
  /** Distancia al ejemplo más parecido. */
  distance: number;
}

function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Calcula qué tan "lejos" es demasiado lejos, a partir de los propios datos:
 * mide la distancia típica entre cada ejemplo y su vecino más cercano.
 */
function estimateMaxDistance<T>(items: T[], dist: (a: T, b: T) => number, min: number, maxChecks: number): number {
  if (items.length < 2) return min * 2;
  const step = Math.max(1, Math.floor(items.length / maxChecks));
  const nearest: number[] = [];
  for (let i = 0; i < items.length; i += step) {
    let best = Infinity;
    for (let j = 0; j < items.length; j++) {
      if (i !== j) best = Math.min(best, dist(items[i], items[j]));
    }
    nearest.push(best);
  }
  nearest.sort((a, b) => a - b);
  return Math.max(min, nearest[Math.floor(nearest.length / 2)] * 4);
}

/** Votación entre los vecinos más cercanos (ya ordenados de más cerca a más lejos). */
function vote(neighbors: { label: string; d: number }[], maxDistance: number): Prediction | null {
  if (!neighbors.length) return null;

  // Los vecinos más cercanos pesan más
  const votes = new Map<string, number>();
  let total = 0;
  for (const n of neighbors) {
    const w = 1 / (n.d + 1e-3);
    votes.set(n.label, (votes.get(n.label) ?? 0) + w);
    total += w;
  }
  let label = '';
  let best = 0;
  for (const [l, v] of votes) {
    if (v > best) {
      best = v;
      label = l;
    }
  }

  const nearest = neighbors[0].d;
  if (nearest > maxDistance) {
    // No se parece a nada que hayamos entrenado
    return { label, confidence: 0, distance: nearest };
  }

  // Confianza = qué parte de los votos ganó, rebajada si está lejos de los ejemplos
  const voteShare = best / total;
  const closeness = 1 - 0.5 * (nearest / maxDistance);
  return { label, confidence: voteShare * closeness, distance: nearest };
}

// ---------- Señas estáticas: k-NN ----------

export interface TrainingSample {
  label: string;
  vector: number[];
}

export class KnnClassifier {
  private samples: TrainingSample[];
  private k: number;
  /** Más allá de esta distancia, consideramos que la mano no se parece a nada conocido. */
  readonly maxDistance: number;

  constructor(samples: TrainingSample[], k = 5) {
    this.samples = samples;
    this.k = Math.max(1, Math.min(k, samples.length));
    // Nunca más estricto que 0.5 (el pulso de la mano siempre varía un poco)
    this.maxDistance = estimateMaxDistance(samples, (a, b) => distance(a.vector, b.vector), 0.5, 200);
  }

  get size(): number {
    return this.samples.length;
  }

  predict(vector: number[]): Prediction | null {
    const neighbors = this.samples
      .map((s) => ({ label: s.label, d: distance(vector, s.vector) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.k);
    return vote(neighbors, this.maxDistance);
  }
}

// ---------- Señas con movimiento: DTW ----------

/**
 * Distancia DTW entre dos secuencias. Busca la mejor forma de emparejar los cuadros
 * (permitiendo que una parte vaya más rápido o más lento) y suma las diferencias.
 */
export function dtwDistance(a: number[][], b: number[][]): number {
  const n = a.length;
  const m = b.length;
  // Solo guardamos dos filas de la tabla para ahorrar memoria
  let prev = new Array<number>(m + 1).fill(Infinity);
  let curr = new Array<number>(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const cost = distance(a[i - 1], b[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] / (n + m); // dividimos por la longitud para que no dependa de la duración
}

export interface SequenceSample {
  label: string;
  frames: number[][];
}

/** Las secuencias se ajustan a este número de cuadros antes de comparar. */
const SEQ_LENGTH = 24;

export class DtwClassifier {
  private samples: SequenceSample[];
  private k: number;
  readonly maxDistance: number;

  constructor(samples: SequenceSample[], k = 3) {
    this.samples = samples.map((s) => ({ label: s.label, frames: resample(s.frames, SEQ_LENGTH) }));
    this.k = Math.max(1, Math.min(k, samples.length));
    this.maxDistance = estimateMaxDistance(this.samples, (a, b) => dtwDistance(a.frames, b.frames), 0.4, 60);
  }

  get size(): number {
    return this.samples.length;
  }

  predict(sequence: number[][]): Prediction | null {
    const seq = resample(sequence, SEQ_LENGTH);
    const neighbors = this.samples
      .map((s) => ({ label: s.label, d: dtwDistance(seq, s.frames) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.k);
    return vote(neighbors, this.maxDistance);
  }
}
