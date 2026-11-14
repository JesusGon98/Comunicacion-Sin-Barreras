// Copia los archivos .wasm de MediaPipe a public/mediapipe/wasm
// para que la detección de manos funcione sin internet.
// Se ejecuta solo después de "npm install" (ver "postinstall" en package.json).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(from)) {
  console.log('MediaPipe no está instalado todavía; se omite la copia.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });
// Solo necesitamos la versión normal y la "nosimd" (para navegadores viejos)
for (const file of readdirSync(from)) {
  if (file.startsWith('vision_wasm_internal') || file.startsWith('vision_wasm_nosimd_internal')) {
    cpSync(join(from, file), join(to, file));
  }
}
console.log('Archivos de MediaPipe copiados a public/mediapipe/wasm');
