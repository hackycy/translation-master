import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'bin/tmigrate': 'bin/tmigrate.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  exports: true,
  publint: true,
})
