import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    VitePWA({
      // O manifest é escrito à mão em public/manifest.webmanifest e já está
      // linkado no index.html. O plugin cuida só do service worker.
      manifest: false,
      registerType: 'autoUpdate',
      // SW só no build. Habilitar em dev deixa o hot reload servindo asset velho.
      devOptions: { enabled: false },
      workbox: {
        // Os handlers de push vivem em public/push-sw.js. O sw.js e regerado a
        // cada build, entao nada pode ser escrito nele à mão — importScripts é
        // como o Workbox deixa a gente somar código próprio ao SW gerado.
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Os bundles do plugin-legacy dobrariam o precache (~3,7 MB) para servir
        // navegador que nem suporta service worker. Continuam no dist e são
        // baixados pela rede normalmente — só não entram no precache.
        globIgnores: ['**/*-legacy-*.js', '**/polyfills-legacy-*.js'],
        // react-big-calendar + o bundle principal passam do default de 2 MiB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // SPA: qualquer navegação cai no index.html...
        navigateFallback: '/index.html',
        // ...menos o que o nginx serve de verdade. /api/uploads são arquivos
        // reais em disco; devolver index.html para eles quebraria as imagens.
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          // NÃO existe entrada de cache para as respostas da API, e é de propósito:
          // agenda servida do cache faria o dono aceitar horário já ocupado.
          // Requisições a /api passam direto pela rede (comportamento padrão do
          // Workbox para o que não casa com nenhuma rota).
          {
            // Imagens enviadas pelos estabelecimentos (logo, fotos). Imutáveis
            // na prática — o nome do arquivo muda quando o upload muda.
            urlPattern: /^.*\/api\/uploads\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'uploads',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2017',
  },
  server: { port: 3001 }
})
