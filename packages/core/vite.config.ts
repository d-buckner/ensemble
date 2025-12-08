import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';


export default defineConfig({
  plugins: [dts({ include: ['src'] })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
      },
      name: 'EnsembleCore',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['mutative', 'msgpackr', 'reflect-metadata', 'virtual:worker-manifest'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
  },
});
