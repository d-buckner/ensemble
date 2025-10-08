import { statSync } from 'fs';
import { bundleVirtualWorker, type BundleResult } from './bundle-worker';
import { generateWorkerEntry } from './generate-worker-entry';
import type { ActorInfo } from './scan-actors';
import type { Connect, ViteDevServer } from 'vite';


const RESOLVED_VIRTUAL_PREFIX = '\0virtual:ensemble-worker-';

interface CachedBundle {
  result: BundleResult;
  mtimes: Map<string, number>;
}

function isCacheStale(cached: CachedBundle): boolean {
  for (const [file, mtime] of cached.mtimes) {
    try {
      const currentMtime = statSync(file).mtimeMs;
      if (currentMtime !== mtime) {
        return true;
      }
    } catch {
      // File no longer exists
      return true;
    }
  }
  return false;
}

async function rebuildAndCache(
  virtualModuleId: string,
  threadId: string,
  threadActors: ActorInfo[],
  allActors: Map<string, ActorInfo>,
  projectRoot: string,
  bundleCache: Map<string, CachedBundle>,
  viteServer?: ViteDevServer
): Promise<BundleResult> {
  const bundleResult = await bundleVirtualWorker(
    virtualModuleId,
    (id) => {
      if (id === virtualModuleId) {
        return generateWorkerEntry(threadId, threadActors, allActors);
      }
    },
    projectRoot
  );

  // Cache the result with file mtimes
  const mtimes = new Map<string, number>();
  for (const file of bundleResult.watchFiles) {
    try {
      mtimes.set(file, statSync(file).mtimeMs);
    } catch {
      // Ignore files that don't exist
    }
  }
  bundleCache.set(threadId, { result: bundleResult, mtimes });

  // Notify Vite to reload modules that import workers
  if (viteServer) {
    const workerModule = viteServer.moduleGraph.getModuleById(virtualModuleId);
    if (workerModule) {
      viteServer.moduleGraph.invalidateModule(workerModule);
      viteServer.ws.send({
        type: 'full-reload',
        path: '*',
      });
    }
  }

  return bundleResult;
}

/**
 * Creates a middleware to serve virtual worker bundles in development mode
 * @param workerOutput The output directory for the worker (e.g., 'workers')
 * @param actorsByThread Map of threadId to ActorInfo[]
 * @param allActors Map of className to ActorInfo for all actors
 * @param projectRoot The project root directory
 * @param viteServer Optional Vite dev server for HMR integration
 * @returns Connect middleware function
 */
export function createWorkerMiddleware(
  workerOutput: string,
  actorsByThread: Map<string, ActorInfo[]>,
  allActors: Map<string, ActorInfo>,
  projectRoot: string,
  viteServer?: ViteDevServer
): Connect.NextHandleFunction {
  const bundleCache = new Map<string, CachedBundle>();

  return async (req, res, next) => {
    const url = req.url || '';
    const workerPathPrefix = `/${workerOutput}/`;

    if (!url.startsWith(workerPathPrefix)) {
      next();
      return;
    }

    // Extract threadId from URL: /workers/worker-1.js -> worker-1
    const threadId = url.slice(workerPathPrefix.length).replace(/\.js$/, '');

    // Check if thread exists
    const actors = actorsByThread.get(threadId);
    if (!actors) {
      res.statusCode = 404;
      res.end(`Thread not found: ${threadId}`);
      return;
    }

    try {
      const virtualModuleId = RESOLVED_VIRTUAL_PREFIX + threadId;
      const cached = bundleCache.get(threadId);

      // Check if cache is still valid
      const shouldRebuild = !cached || isCacheStale(cached);

      const bundleResult = shouldRebuild
        ? await rebuildAndCache(virtualModuleId, threadId, actors, allActors, projectRoot, bundleCache, viteServer)
        : cached.result;

      res.setHeader('Content-Type', 'application/javascript');
      res.end(bundleResult.code);
    } catch (error) {
      res.statusCode = 500;
      res.end(`Failed to bundle worker for thread "${threadId}": ${error}`);
    }
  };
}
