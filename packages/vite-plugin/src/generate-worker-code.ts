import type { ThreadConfig } from '@d-buckner/ensemble-core';

/**
 * Generates worker entry code that imports and registers actors
 * @param threadConfig - Configuration for this thread
 * @returns Generated worker entry code
 */
export function generateWorkerEntryCode(
  threadConfig: ThreadConfig,
  _projectRoot: string
): string {
  // Generate import statements for each actor
  const imports = threadConfig.actors
    .map((actor, index) => {
      // Use relative paths - Rollup will resolve them from the virtual module context
      return `import { ${actor.name} as Actor${index} } from '${actor.path}';`;
    })
    .join('\n');

  // Generate registration object
  const registrations = threadConfig.actors
    .map((actor, index) => `  ${actor.name}: Actor${index}`)
    .join(',\n');

  return `/**
 * Auto-generated worker entry file
 * DO NOT EDIT - Generated from ensemble.json
 */

${imports}
import WorkerRuntime from '@d-buckner/ensemble-core/dist/threading/WorkerRuntime';

// Register actors for this worker thread
WorkerRuntime.registerActors({
${registrations}
});
`;
}
