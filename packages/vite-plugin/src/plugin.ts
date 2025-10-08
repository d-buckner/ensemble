import type { Plugin, ResolvedConfig } from 'vite';
import type { EnsemblePluginOptions } from './types';
import { createWorkerMiddleware } from './dev-server';
import { scanForThreadActors, scanAllActors, type ActorInfo } from './scan-actors';
import { generateWorkerEntry } from './generate-worker-entry';
import { bundleVirtualWorker } from './bundle-worker';
import { createHash } from 'crypto';

const VIRTUAL_MODULE_PREFIX = 'virtual:ensemble-worker-';
const RESOLVED_VIRTUAL_PREFIX = '\0' + VIRTUAL_MODULE_PREFIX;
const MANIFEST_MODULE_ID = 'virtual:ensemble-worker-manifest';
const RESOLVED_MANIFEST_ID = '\0' + MANIFEST_MODULE_ID;

export function ensemblePlugin(options: EnsemblePluginOptions = {}): Plugin {
  const { workerOutput = 'workers' } = options;

  let config: ResolvedConfig;
  let actorsByThread: Map<string, ActorInfo[]> = new Map();
  let allActors: Map<string, ActorInfo> = new Map();
  let workerBundles: Map<string, string> = new Map();
  let workerPaths: Record<string, string> = {};

  const plugin: Plugin & { _test?: { workerBundles: Map<string, string>; workerPaths: Record<string, string> } } = {
    name: 'ensemble-vite-plugin',

    async configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Scan for ALL actors (both main thread and worker)
      allActors = await scanAllActors(config.root);

      // Scan for actors with @thread decorator
      actorsByThread = await scanForThreadActors(config.root);
    },

    resolveId(id) {
      if (id === MANIFEST_MODULE_ID) {
        return RESOLVED_MANIFEST_ID;
      }
      if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return RESOLVED_VIRTUAL_PREFIX + id.slice(VIRTUAL_MODULE_PREFIX.length);
      }
    },

    load(id) {
      if (id === RESOLVED_MANIFEST_ID) {
        // Return worker paths (with hashes in production, simple paths in dev)
        return `export const WORKER_PATHS = ${JSON.stringify(workerPaths, null, 2)};`;
      }

      if (id.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
        const threadId = id.slice(RESOLVED_VIRTUAL_PREFIX.length);
        const threadActors = actorsByThread.get(threadId);

        if (!threadActors) {
          return undefined;
        }

        return generateWorkerEntry(threadId, threadActors, allActors);
      }
    },

    async buildStart() {
      // In dev mode, use simple paths (Vite handles cache busting)
      if (config.command === 'serve') {
        workerPaths = {};
        for (const threadId of actorsByThread.keys()) {
          workerPaths[threadId] = `./${workerOutput}/${threadId}.js`;
        }
        return;
      }

      // In build mode, bundle workers and compute hashed paths
      for (const threadId of actorsByThread.keys()) {
        const virtualModuleId = RESOLVED_VIRTUAL_PREFIX + threadId;

        try {
          const bundleResult = await bundleVirtualWorker(
            virtualModuleId,
            (id) => {
              if (id === virtualModuleId) {
                const threadActors = actorsByThread.get(threadId);
                if (!threadActors) return undefined;
                return generateWorkerEntry(threadId, threadActors, allActors);
              }
            },
            config.root
          );

          const bundledCode = bundleResult.code;
          workerBundles.set(threadId, bundledCode);

          // Compute content hash for production builds
          const hash = createHash('sha256').update(bundledCode).digest('hex').substring(0, 8);
          const fileName = `${workerOutput}/${threadId}-${hash}.js`;
          workerPaths[threadId] = `./${fileName}`;
        } catch (error) {
          this.error(`Failed to bundle worker for thread "${threadId}": ${error}`);
        }
      }
    },

    generateBundle() {
      // Only emit if there are workers
      if (workerBundles.size === 0) {
        return;
      }

      // Emit worker bundles as assets using pre-computed hashed paths
      for (const [threadId, bundledCode] of workerBundles.entries()) {
        const workerPath = workerPaths[threadId];
        // Remove leading './' to get the fileName
        const fileName = workerPath.startsWith('./') ? workerPath.slice(2) : workerPath;

        this.emitFile({
          type: 'asset',
          fileName,
          source: bundledCode,
        });
      }

      // Emit worker manifest for reference (though virtual module is inlined)
      const manifestCode = `export const WORKER_PATHS = ${JSON.stringify(workerPaths, null, 2)};`;

      this.emitFile({
        type: 'asset',
        fileName: `${workerOutput}/manifest.js`,
        source: manifestCode,
      });
    },

    configureServer(server) {
      // Serve the worker during development with smart caching
      server.middlewares.use(createWorkerMiddleware(workerOutput, actorsByThread, allActors, config.root, server));
    },
  };

  // Expose internal state for testing
  plugin._test = { workerBundles, workerPaths };

  return plugin;
}
