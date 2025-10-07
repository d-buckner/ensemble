import type { ActorInfo } from './scan-actors';
import { WORKER_ENTRY_TEMPLATE } from './worker-entry-template';

/**
 * Generates a worker entry file content for a specific thread
 * by reading the template and replacing placeholders with actor-specific code
 */
export function generateWorkerEntry(threadId: string, actors: ActorInfo[]): string {
  const template = WORKER_ENTRY_TEMPLATE;

  const actorImports = actors
    .map((actor) => {
      let modulePath = actor.filePath.replace(/\\/g, '/');

      // Prepend ./ for relative paths, keep extension for Rollup
      if (!modulePath.startsWith('/')) {
        modulePath = './' + modulePath;
      }

      return `import { ${actor.className} } from '${modulePath}';`;
    })
    .join('\n');

  const actorRegistry = actors
    .map((actor) => `  '${actor.className}': ${actor.className},`)
    .join('\n');

  return template
    .replace('// %ACTOR_IMPORTS%', actorImports)
    .replace('  // %ACTOR_REGISTRY%', actorRegistry);
}
