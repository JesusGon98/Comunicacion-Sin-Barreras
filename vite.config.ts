import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Configuración de Vite.
// El plugin PWA genera el manifest (nombre, íconos, colores) y el service worker,
// que guarda en caché todos los archivos para que la app funcione sin internet.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Pregunta antes de actualizar (para no recargar a la mitad de una conversación).
      // El aviso está en src/app/OfflineNotice.tsx.
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Comunicación sin Barreras — Traductor LSM',
        short_name: 'Sin Barreras',
        description:
          'Ayuda a personas oyentes y personas sordas a comunicarse con voz, texto y Lengua de Señas Mexicana.',
        lang: 'es-MX',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Archivos que se guardan en caché para uso offline.
        // Incluimos .task (el modelo de MediaPipe que agregaremos en la fase 3) y .wasm.
        // .json = paquete oficial de señas incluido (public/signs/).
        // .glb = modelos 3D de la mano (public/models/).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,task,wasm,json,glb}'],
        // La versión "nosimd" solo la usan navegadores muy viejos: no la guardamos para ahorrar ~13 MB.
        globIgnores: ['**/vision_wasm_nosimd_internal.*'],
        // El modelo de manos pesa varios MB; subimos el límite de tamaño por archivo.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
      devOptions: {
        // Activa el service worker también con `npm run dev` para poder probar la instalación.
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
