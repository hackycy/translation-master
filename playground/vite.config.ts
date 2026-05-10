import { resolve } from 'node:path'
import TranslatePlugin from '@translation-master/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 8187,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dom: resolve(__dirname, 'dom.html'),
        migrate: resolve(__dirname, 'migrate.html'),
      },
    },
  },
  plugins: [
    TranslatePlugin({
      inject: true,
      version: '3.18.66',
    }),
  ],
})
