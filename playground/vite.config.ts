import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import TranslatePlugin from 'vite-plugin-translate'

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
