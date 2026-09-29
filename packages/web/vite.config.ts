import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
