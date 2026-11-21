// Detección de manos con MediaPipe HandLandmarker.
// Encuentra 21 puntos por mano en cada imagen de la cámara, todo dentro del navegador:
// ninguna imagen sale del dispositivo.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './normalize';

// Archivos locales (copiados en public/) para que funcione sin internet
const BASE = document.baseURI.replace(/[^/]*$/, ''); // carpeta base de la app (<base href>)
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

export type Handedness = 'Left' | 'Right';

export interface DetectedHand {
  landmarks: Landmark[];
  handedness: Handedness;
  /** Qué tan seguro está MediaPipe de que es una mano (0 a 1). */
  score: number;
}

/** Lo que se detectó en un cuadro de la cámara, ya listo para comparar. */
export interface HandFrame {
  /** Forma de la mano normalizada (63 números, ver normalize.ts). */
  vector: number[];
  handedness: Handedness;
  /** Posición de la muñeca en la imagen (para señas con movimiento). */
  wrist: { x: number; y: number };
  /** Tamaño de la mano en la imagen. */
  size: number;
  time: number;
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;

/** Carga el modelo una sola vez (tarda unos segundos la primera vez). */
export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO' as const,
        numHands: 1, // por ahora reconocemos señas de una mano
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        // La tarjeta gráfica (GPU) es más rápida...
        return await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        // ...pero si no está disponible usamos el procesador (CPU)
        return await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
    })();
    // Si falla, permitimos reintentar más tarde
    landmarkerPromise.catch(() => {
      landmarkerPromise = null;
    });
  }
  return landmarkerPromise;
}

/** Detecta una mano en el cuadro actual del video. Devuelve null si no hay mano. */
export function detectHand(landmarker: HandLandmarker, video: HTMLVideoElement, timeMs: number): DetectedHand | null {
  const result = landmarker.detectForVideo(video, timeMs);
  if (!result.landmarks.length) return null;
  const category = result.handedness[0]?.[0];
  return {
    landmarks: result.landmarks[0],
    handedness: category?.categoryName === 'Left' ? 'Left' : 'Right',
    score: category?.score ?? 0,
  };
}

// Pares de puntos que se unen con líneas para dibujar el "esqueleto" de la mano.
// 0 = muñeca; 1-4 pulgar; 5-8 índice; 9-12 medio; 13-16 anular; 17-20 meñique.
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

/** Dibuja los puntos y líneas de la mano sobre un canvas (coordenadas de 0 a 1). */
export function drawHand(ctx: CanvasRenderingContext2D, landmarks: Landmark[], color = '#ffd60a'): void {
  const { width, height } = ctx.canvas;
  const line = Math.max(2, width / 200);

  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, line * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
