// Herramientas para señas con movimiento (J, K, Ñ, Q, X, Z, LL, RR y palabras).
//
// Una seña con movimiento se guarda como una SECUENCIA de cuadros. Cada cuadro tiene
// 65 números: los 63 de la forma de la mano + 2 que dicen cuánto se movió la muñeca
// (en "tamaños de mano") desde el primer cuadro.

import type { HandFrame } from './hands';

/** Cada cuánto se toma un cuadro, al grabar y al reconocer (~15 por segundo). */
export const TICK_MS = 66;

/** Peso del movimiento de la muñeca frente a la forma de la mano. */
export const MOTION_WEIGHT = 2;

/** Por debajo de esto, la mano se considera quieta. */
export const STILL_ENERGY = 0.1;
/** Por encima de esto, la mano se está moviendo. */
export const MOVING_ENERGY = 0.18;

function euclid(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Cuánto cambió la mano entre dos cuadros (movimiento de la muñeca + cambio de forma). */
export function motionEnergy(a: HandFrame, b: HandFrame): number {
  const size = (a.size + b.size) / 2 || 1;
  const wristMove = Math.hypot(b.wrist.x - a.wrist.x, b.wrist.y - a.wrist.y) / size;
  return wristMove + 0.3 * euclid(a.vector, b.vector);
}

/**
 * Quita los cuadros quietos del principio y del final.
 * Devuelve null si casi no hubo movimiento.
 */
export function trimStill(frames: HandFrame[]): HandFrame[] | null {
  let first = -1;
  let last = -1;
  let moving = 0;
  for (let i = 1; i < frames.length; i++) {
    if (motionEnergy(frames[i - 1], frames[i]) > STILL_ENERGY) {
      if (first < 0) first = i - 1;
      last = i;
      moving++;
    }
  }
  if (moving < 3) return null;
  return frames.slice(Math.max(0, first - 2), Math.min(frames.length, last + 3));
}

/** Convierte cuadros de la cámara en la secuencia de 65 números por cuadro. */
export function toSequence(frames: HandFrame[]): number[][] {
  const start = frames[0].wrist;
  const size = frames.reduce((s, f) => s + f.size, 0) / frames.length || 1;
  return frames.map((f) => [
    ...f.vector,
    ((f.wrist.x - start.x) / size) * MOTION_WEIGHT,
    ((f.wrist.y - start.y) / size) * MOTION_WEIGHT,
  ]);
}

/** Cambia la secuencia a un número fijo de cuadros (para comparar señas rápidas y lentas). */
export function resample(seq: number[][], n = 24): number[][] {
  if (seq.length === n) return seq;
  if (seq.length === 1) return Array.from({ length: n }, () => seq[0]);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i * (seq.length - 1)) / (n - 1);
    const a = Math.floor(pos);
    const b = Math.min(seq.length - 1, a + 1);
    const t = pos - a;
    out.push(seq[a].map((v, k) => v + (seq[b][k] - v) * t));
  }
  return out;
}

/**
 * Convierte la secuencia en poses de 63 números para dibujar la mano:
 * a la forma de cada cuadro le sumamos cuánto se movió la muñeca.
 */
export function sequenceToPoses(seq: number[][]): number[][] {
  return seq.map((f) => {
    const dx = f[63] / MOTION_WEIGHT;
    const dy = f[64] / MOTION_WEIGHT;
    const pose = f.slice(0, 63);
    for (let i = 0; i < 63; i += 3) {
      pose[i] += dx;
      pose[i + 1] += dy;
    }
    return pose;
  });
}
