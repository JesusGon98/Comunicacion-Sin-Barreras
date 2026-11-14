// Tonos de piel para la mano 3D (la app es para todas las personas).
// Está en un archivo aparte para no cargar three.js solo por leer esta lista.

export const SKIN_TONES = [
  { id: 'muy-clara', name: 'Muy clara', color: '#f1d0bb' },
  { id: 'clara', name: 'Clara', color: '#dfae8c' },
  { id: 'media', name: 'Media', color: '#c58b65' },
  { id: 'morena', name: 'Morena', color: '#a06646' },
  { id: 'morena-oscura', name: 'Morena oscura', color: '#7a472e' },
  { id: 'oscura', name: 'Oscura', color: '#53301f' },
] as const;

export type SkinToneId = (typeof SKIN_TONES)[number]['id'];

export const DEFAULT_SKIN: SkinToneId = 'media';

export function skinColor(id: string): string {
  return (SKIN_TONES.find((t) => t.id === id) ?? SKIN_TONES[2]).color;
}
