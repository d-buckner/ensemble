import type { Plugin, ResolvedConfig } from 'vite';
import type { EnsemblePluginOptions } from './types';
import { createWorkerMiddleware } from './dev-server';
import { scanForThreadActors, type ActorInfo } from './scan-actors';
import { generateWorkerEntry } from './generate-worker-entry';
import { bundleVirtualWorker } from './bundle-worker';

const VIRTUAL_MODULE_PREFIX = 'virtual:ensemble-worker-';
const RESOLVED_VIRTUAL_PREFIX = '\0' + VIRTUAL_MODULE_PREFIX;

export function ensemblePlugin(options: EnsemblePluginOptions = {}): Plugin {
  const { workerOutput = 'workers' } = options;

  let config: ResolvedConfig;
  let actorsByThread: Map<string, ActorInfo[]> = new Map();
  let workerBundles: Map<string, string> = new Map();

  const plugin: Plugin & { _test?: { workerBundles: Map<string, string> } } = {
    name: 'ensemble-vite-plugin',

    async configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Scan for actors with @thread decorator
      actorsByThread = await scanForThreadActors(config.root);
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return RESOLVED_VIRTUAL_PREFIX + id.slice(VIRTUAL_MODULE_PREFIX.length);
      }
    },

    load(id) {
      if (id.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
        const threadId = id.slice(RESOLVED_VIRTUAL_PREFIX.length);
        const actors = actorsByThread.get(threadId);

        if (!actors) {
          return undefined;
        }

        return generateWorkerEntry(threadId, actors);
      }
    },

    async buildStart() {
      // Bundle each virtual worker module
      for (const threadId of actorsByThread.keys()) {
        const virtualModuleId = RESOLVED_VIRTUAL_PREFIX + threadId;

        try {
          const bundledCode = await bundleVirtualWorker(
            virtualModuleId,
            (id) => {
              if (id === virtualModuleId) {
                const actors = actorsByThread.get(threadId);
                if (!actors) return undefined;
                return generateWorkerEntry(threadId, actors);
              }
            },
            config.root
          );

          workerBundles.set(threadId, bundledCode);
        } catch (error) {
          this.error(`Failed to bundle worker for thread "${threadId}": ${error}`);
        }
      }
    },

    generateBundle() {
      // Emit worker bundles as assets
      for (const [threadId, bundledCode] of workerBundles.entries()) {
        this.emitFile({
          type: 'asset',
          fileName: `${workerOutput}/${threadId}.js`,
          source: bundledCode,
        });
      }
    },

    configureServer(server) {
      // Serve the worker during development
      server.middlewares.use(createWorkerMiddleware(workerOutput, actorsByThread, config.root));
    },
  };

  // Expose internal state for testing
  plugin._test = { workerBundles };

  return plugin;
}
