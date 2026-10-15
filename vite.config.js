import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME } from './src/config.js';

export default defineConfig({
  // './' para que funcione igual en local y en GitHub Pages
  base: './',
  // Número de versión que se ve en la pantalla de inicio (fecha y hora de compilación)
  define: { __VERSION__: JSON.stringify(new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' })) },
  plugins: [
    basicSsl(),
    // Pone el nombre de la app (src/config.js) en index.html
    { name: 'nombre-app', transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME) },
    VitePWA({
      registerType: 'autoUpdate',   // si publicas una versión nueva, se actualiza sola
      injectRegister: false,        // se registra en src/main.js
      includeAssets: ['iconos/*'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'Información en realidad aumentada sobre elementos industriales con códigos QR',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1b24',
        theme_color: '#0f1b24',
        icons: [
          { src: 'iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Guardar TODO en el móvil para que funcione en modo avión
        globPatterns: ['**/*.{js,mjs,css,html,wasm,svg,png,ico,pdf,webmanifest,bcmap,pfb,ttf}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { https: true, host: true, port: 5173 },
  preview: { https: true, host: true, port: 4173 },
  // Navegadores modernos (Safari 16.4+ / Chrome): necesario para pdf.js
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  worker: { format: 'es' },
});
