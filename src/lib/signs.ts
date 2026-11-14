// Diccionario de señas y deletreo.
//
// Convierte un texto en una lista de "pasos" para mostrar:
//   - Si una palabra (o frase) está en el diccionario de señas entrenadas, se usa esa seña.
//   - Si no, se deletrea letra por letra con el alfabeto manual.
// Las letras dobles del alfabeto (LL, RR) se reconocen como una sola seña.

import type { SignLanguageConfig } from '../config/language';
import { dtwDistance } from './classifier';

export type SignToken =
  /** Palabra o frase que tiene su propia seña. */
  | { kind: 'word'; label: string; text: string }
  /** Letra del alfabeto manual. */
  | { kind: 'letter'; label: string }
  /** Separación entre palabras. */
  | { kind: 'space' }
  /** Número u otro carácter que no tiene seña en el alfabeto. */
  | { kind: 'other'; text: string };

const ENYE = ''; // marcador temporal para que la Ñ no pierda su tilde

/** Minúsculas y sin acentos (pero conservando la ñ): "Días" → "dias", "Niño" → "niño". */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ñ/g, ENYE)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos y diéresis
    .replace(new RegExp(ENYE, 'g'), 'ñ');
}

/** Quita signos de puntuación de los extremos: "¿hola?" → "hola". */
function stripPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Deletrea una palabra con el alfabeto manual. */
function spell(word: string, lang: SignLanguageConfig): SignToken[] {
  const tokens: SignToken[] = [];
  const upper = foldText(word).toUpperCase();
  let i = 0;
  while (i < upper.length) {
    const pair = upper.slice(i, i + 2);
    if (pair.length === 2 && lang.alphabet.includes(pair)) {
      tokens.push({ kind: 'letter', label: pair }); // LL, RR
      i += 2;
    } else {
      const ch = upper[i];
      if (lang.alphabet.includes(ch)) tokens.push({ kind: 'letter', label: ch });
      else if (/\p{N}/u.test(ch)) tokens.push({ kind: 'other', text: ch }); // números
      // otros signos (comas, puntos…) se ignoran
      i += 1;
    }
  }
  return tokens;
}

/**
 * Convierte un texto en pasos de señas.
 * @param wordLabels nombres de las señas de palabras/frases que hay en el diccionario.
 */
export function textToSigns(text: string, wordLabels: string[], lang: SignLanguageConfig): SignToken[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const folded = words.map((w) => foldText(stripPunctuation(w)));

  // Frases del diccionario separadas en palabras, de la más larga a la más corta
  const entries = wordLabels
    .map((label) => ({ label, parts: foldText(label).split(/\s+/) }))
    .sort((a, b) => b.parts.length - a.parts.length);

  const tokens: SignToken[] = [];
  let i = 0;
  while (i < words.length) {
    if (tokens.length) tokens.push({ kind: 'space' });

    // ¿Alguna frase del diccionario empieza aquí?
    const match = entries.find((e) => e.parts.every((p, j) => folded[i + j] === p));
    if (match) {
      tokens.push({ kind: 'word', label: match.label, text: words.slice(i, i + match.parts.length).join(' ') });
      i += match.parts.length;
    } else {
      tokens.push(...spell(words[i], lang));
      i += 1;
    }
  }
  return tokens;
}

/**
 * De todos los ejemplos grabados de una seña, elige el más "típico":
 * el que está más cerca del promedio de todos. Así la mano animada se ve natural.
 */
export function representativePose(examples: number[][]): number[] {
  if (examples.length === 1) return examples[0];
  const n = examples[0].length;
  const mean = new Array<number>(n).fill(0);
  for (const e of examples) for (let i = 0; i < n; i++) mean[i] += e[i] / examples.length;

  let best = examples[0];
  let bestDist = Infinity;
  for (const e of examples) {
    let d = 0;
    for (let i = 0; i < n; i++) d += (e[i] - mean[i]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/**
 * Igual que representativePose, pero para señas con movimiento: elige la repetición
 * que más se parece a todas las demás (comparando con DTW).
 */
export function representativeSequence(examples: number[][][]): number[][] {
  if (examples.length <= 2) return examples[0];
  const list = examples.slice(0, 20); // con 20 basta y es más rápido
  let best = list[0];
  let bestTotal = Infinity;
  for (const a of list) {
    let total = 0;
    for (const b of list) if (a !== b) total += dtwDistance(a, b);
    if (total < bestTotal) {
      bestTotal = total;
      best = a;
    }
  }
  return best;
}

/** Mezcla dos poses: t = 0 → pose a, t = 1 → pose b. */
export function lerpPose(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}
