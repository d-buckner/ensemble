import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

/**
 * Builds the Ensemble worker bundle using Rollup
 * @returns The bundled worker code as a string
 */
export async function buildWorkerBundle(): Promise<string> {
  const bundle = await rollup({
    input: '@d-buckner/ensemble-core/worker',
    external: [],
    plugins: [
      nodeResolve({
        extensions: ['.js'],
      }),
      commonjs(),
    ],
  });

  try {
    const { output } = await bundle.generate({
      format: 'iife',
      name: 'EnsembleWorker',
    });

    // Get the bundled code from the first chunk
    const chunk = output.find(item => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') {
      throw new Error('No chunk generated from worker bundle');
    }

    return chunk.code;
  } finally {
    await bundle.close();
  }
}
