// Normalización de los puntos de la mano.
//
// MediaPipe da 21 puntos con coordenadas de la imagen (de 0 a 1). La misma seña
// da números distintos si la mano está más cerca, más lejos o en otra parte de la
// pantalla. Para poder comparar señas, convertimos los puntos a una forma "estándar":
//   1. Relativos a la muñeca (la muñeca queda en 0,0,0).
//   2. Escalados por el tamaño de la mano (distancia muñeca → base del dedo medio = 1).
//   3. La mano izquierda se refleja para que parezca derecha (así una sola
//      muestra sirve para personas diestras y zurdas).

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

const WRIST = 0;
const MIDDLE_BASE = 9;

/**
 * Devuelve un arreglo de 63 números (21 puntos × x, y, z) ya normalizado,
 * o null si la mano es demasiado pequeña para medirla.
 * @param aspect ancho / alto del video, para que x e y usen la misma escala.
 */
export function normalizeHand(landmarks: Landmark[], isLeftHand: boolean, aspect: number): number[] | null {
  const wrist = landmarks[WRIST];

  // 1. Relativo a la muñeca (x y z se corrigen con el aspecto del video)
  const pts = landmarks.map((p) => [(p.x - wrist.x) * aspect, p.y - wrist.y, (p.z - wrist.z) * aspect]);

  // 3. Reflejar la mano izquierda
  if (isLeftHand) for (const p of pts) p[0] = -p[0];

  // 2. Escalar por el tamaño de la mano
  const [mx, my, mz] = pts[MIDDLE_BASE];
  const size = Math.hypot(mx, my, mz);
  if (size < 1e-6) return null;

  return pts.flatMap(([x, y, z]) => [x / size, y / size, z / size]);
}

/**
 * Posición de la muñeca y tamaño de la mano en la imagen.
 * Sirve para las señas con movimiento: la forma de la mano no basta, también importa
 * hacia dónde se mueve. Usa la misma corrección de aspecto y el mismo reflejo que normalizeHand.
 */
export function handGeometry(
  landmarks: Landmark[],
  isLeftHand: boolean,
  aspect: number,
): { wrist: { x: number; y: number }; size: number } {
  const w = landmarks[WRIST];
  const m = landmarks[MIDDLE_BASE];
  const size = Math.hypot((m.x - w.x) * aspect, m.y - w.y, (m.z - w.z) * aspect);
  const x = w.x * aspect;
  return { wrist: { x: isLeftHand ? -x : x, y: w.y }, size };
}

/** Convierte el arreglo de 63 números otra vez en 21 puntos (útil para dibujar). */
export function vectorToPoints(vector: number[]): Landmark[] {
  const points: Landmark[] = [];
  for (let i = 0; i < vector.length; i += 3) {
    points.push({ x: vector[i], y: vector[i + 1], z: vector[i + 2] });
  }
  return points;
}
