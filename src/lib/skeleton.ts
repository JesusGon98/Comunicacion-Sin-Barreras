// Dibuja la "mano esqueleto" en 2D a partir de los puntos normalizados
// (los mismos que se graban en el modo Entrenar).

import { HAND_CONNECTIONS } from './hands';

// Un color por dedo para que sea más fácil distinguirlos
const FINGER_COLORS = ['#ff9f1c', '#ffd60a', '#3ddc84', '#4cc9ff', '#c77dff'];
const PALM_COLOR = '#ffffff';

/** Qué dedo es cada punto (−1 = palma/muñeca). */
function fingerOf(point: number): number {
  return point === 0 ? -1 : Math.floor((point - 1) / 4);
}

/** Rectángulo que ocupa una o varias poses. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Calcula el rectángulo que ocupan todas las poses (para que una seña con movimiento quepa entera). */
export function poseBounds(poses: number[][]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const pose of poses) {
    for (let i = 0; i < pose.length; i += 3) {
      b.minX = Math.min(b.minX, pose[i]);
      b.maxX = Math.max(b.maxX, pose[i]);
      b.minY = Math.min(b.minY, pose[i + 1]);
      b.maxY = Math.max(b.maxY, pose[i + 1]);
    }
  }
  return b;
}

/**
 * Dibuja la mano en el canvas.
 * @param pose 63 números (21 puntos × x, y, z) normalizados.
 * @param mirror true = vista de espejo (como te ves tú en la cámara frontal).
 * @param bounds zona fija a encuadrar (señas con movimiento). Si no se da, la mano se centra.
 */
export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: number[], mirror: boolean, bounds?: Bounds): void {
  const { width, height } = ctx.canvas;
  const flip = mirror ? 1 : -1;

  const pts = [];
  for (let i = 0; i < pose.length; i += 3) pts.push({ x: pose[i] * flip, y: pose[i + 1], z: pose[i + 2] });

  // Encuadre: la mano (o todo el movimiento) centrado y escalado para que quepa
  const b = bounds ?? poseBounds([pose]);
  const minX = mirror ? b.minX : -b.maxX;
  const maxX = mirror ? b.maxX : -b.minX;
  const { minY, maxY } = b;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const base = Math.min(width, height) / 4.2; // tamaño normal: la palma mide 1/4 del lienzo
  const fit = Math.min((width * 0.85) / (maxX - minX || 1), (height * 0.85) / (maxY - minY || 1));
  const scale = Math.min(base, fit);

  const toScreen = (p: { x: number; y: number }) => ({
    x: width / 2 + (p.x - cx) * scale,
    y: height / 2 + (p.y - cy) * scale,
  });
  const screen = pts.map(toScreen);
  const line = Math.max(4, scale / 9);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Huesos (líneas)
  for (const [a, b] of HAND_CONNECTIONS) {
    // Línea dentro de un mismo dedo → color del dedo. Muñeca → pulgar también es pulgar. El resto es palma.
    const sameFinger = fingerOf(a) === fingerOf(b) && fingerOf(a) >= 0;
    if (sameFinger) ctx.strokeStyle = FINGER_COLORS[fingerOf(a)];
    else if (a === 0 && b === 1) ctx.strokeStyle = FINGER_COLORS[0];
    else ctx.strokeStyle = PALM_COLOR;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(screen[a].x, screen[a].y);
    ctx.lineTo(screen[b].x, screen[b].y);
    ctx.stroke();
  }

  // Articulaciones (círculos). Los puntos más cercanos a la cámara (z negativo) se ven un poco más grandes.
  pts.forEach((p, i) => {
    const finger = fingerOf(i);
    const r = Math.max(3, line * (0.75 - Math.max(-0.3, Math.min(0.3, p.z)) * 0.8));
    ctx.fillStyle = finger >= 0 ? FINGER_COLORS[finger] : PALM_COLOR;
    ctx.strokeStyle = '#0b0f14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen[i].x, screen[i].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}
