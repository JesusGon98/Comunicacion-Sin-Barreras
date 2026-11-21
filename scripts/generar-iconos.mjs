// Genera todos los íconos de la app a partir de un solo dibujo: assets/brand/simbolo.svg
// Uso: npm run icons
//
// Salida (public/icons/):
//   favicon.svg             pestaña del navegador (solo el símbolo, fondo transparente)
//   icon-192.png / -512     ícono de la app instalada (Android, escritorio)
//   icon-maskable-512.png   ícono "adaptable" de Android (más margen, el sistema lo recorta)
//   apple-touch-icon.png    ícono en la pantalla de inicio del iPhone (180 px)
//   favicon-32.png          pestaña en navegadores que no usan SVG
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
const svg = readFileSync(join(root, 'assets', 'brand', 'simbolo.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const BG = '#ffffff';

/** Pone el símbolo sobre un fondo, ocupando "scale" del ancho, centrado. */
function compose(scale, { background = BG, radius = 0 } = {}) {
  const s = 512 * scale;
  const off = (512 - s) / 2;
  const bg = background ? `<rect width="512" height="512" rx="${radius}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}<g transform="translate(${off} ${off}) scale(${scale})">${inner}</g></svg>`;
}

function png(source, size, file) {
  const img = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(out, file), img);
  console.log(`  ${file} (${size}×${size})`);
}

writeFileSync(join(out, 'favicon.svg'), compose(1, { background: null }));
console.log('  favicon.svg');
png(compose(0.84), 192, 'icon-192.png');
png(compose(0.84), 512, 'icon-512.png');
png(compose(0.66), 512, 'icon-maskable-512.png'); // zona segura: círculo del 80 %
png(compose(0.78), 180, 'apple-touch-icon.png');
png(compose(1, { background: null }), 32, 'favicon-32.png');
console.log(`Íconos generados en ${out}`);
