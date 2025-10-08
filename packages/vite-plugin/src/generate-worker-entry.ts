import { WORKER_ENTRY_TEMPLATE } from './worker-entry-template';
import type { ActorInfo } from './scan-actors';

/**
 * Generates a worker entry file content for a specific thread
 * by reading the template and replacing placeholders with actor-specific code
 */
export function generateWorkerEntry(
  threadId: string,
  threadActors: ActorInfo[],
  allActors: Map<string, ActorInfo>
): string {
  const template = WORKER_ENTRY_TEMPLATE;

  const actorImports = threadActors
    .map((actor) => {
      let modulePath = actor.filePath.replace(/\\/g, '/');

      // Strip file extensions (.ts, .tsx, .js, .jsx)
      modulePath = modulePath.replace(/\.(ts|tsx|js|jsx)$/, '');

      // Prepend ./ for relative paths (Vite requirement)
      if (!modulePath.startsWith('/')) {
        modulePath = './' + modulePath;
      }

      return `import { ${actor.className} } from '${modulePath}';`;
    })
    .join('\n');

  const actorRegistry = threadActors
    .map((actor) => `  '${actor.className}': ${actor.className},`)
    .join('\n');

  // Include metadata for ALL actors (needed for dependency injection across threads)
  const actorMetadata = Array.from(allActors.values())
    .map((actor) => {
      const stateJson = JSON.stringify(actor.initialState);
      return `  '${actor.className}': ${stateJson},`;
    })
    .join('\n');

  return template
    .replace('// %ACTOR_IMPORTS%', actorImports)
    .replace('  // %ACTOR_REGISTRY%', actorRegistry)
    .replace('  // %ACTOR_METADATA%', actorMetadata);
}
