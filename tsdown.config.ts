import { defineConfig } from 'tsdown'

export default defineConfig({
  exports: true,
  dts: true,
  format: ['cjs', 'esm'],
  target: 'es2020',
  platform: 'node',
  minify: true,
  logLevel: 'warn',
})
