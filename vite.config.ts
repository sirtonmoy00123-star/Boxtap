import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt', // updates are offered, never forced (ARCHITECTURE §6.1, W3)
      injectRegister: false,
      manifest: {
        name: 'BoxTap',
        short_name: 'BoxTap',
        description: 'Know what is in every box without opening it.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // @ts-expect-error launch_handler is not in the plugin's manifest type yet
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,woff2,json}'],
        globIgnores: ['config/**', 'oauth.html'], // audit B11/B17: never precache config or the OAuth page
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/config\//, /^\/oauth/],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
