import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';


export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
      include: ['src/**/*'],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'server/index': resolve(__dirname, 'src/server/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        '@d-buckner/ensemble-core',
        '@automerge/automerge',
        'socket.io-client',
        'socket.io',
        'http',
        'https',
      ],
      output: {
        preserveModules: false,
        entryFileNames: '[name].js',
      },
    },
    sourcemap: true,
  },
});
