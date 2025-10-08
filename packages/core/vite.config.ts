import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';


export default defineConfig({
  plugins: [dts({ include: ['src'] })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'threading/worker-entry': resolve(__dirname, 'src/threading/worker-entry.ts'),
      },
      name: 'EnsembleCore',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['immer', 'msgpackr', 'reflect-metadata', 'virtual:worker-manifest'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
  },
});
