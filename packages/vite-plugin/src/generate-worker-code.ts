import type { ThreadConfig } from '@d-buckner/ensemble-core';

/**
 * Generates worker entry code that properly initializes WorkerRuntime
 *
 * The generated code:
 * 1. Imports all actors configured for this thread
 * 2. Creates actor registry (className -> ActorConstructor)
 * 3. Creates actor metadata (className -> initialState) for dependency hydration
 * 4. Instantiates WorkerBus and WorkerRuntime
 * 5. Sets up message listener to handle instantiation commands and action messages
 *
 * @param threadConfig - Configuration for this thread from ensemble.json
 * @param threadId - The thread identifier (used in error messages)
 * @returns Generated worker entry code
 */
export function generateWorkerEntryCode(
  threadConfig: ThreadConfig,
  threadId: string
): string {
  // Generate import statements for each actor
  const actorImports = threadConfig.actors
    .map((actor, index) => {
      // Use relative paths - Rollup will resolve them from the virtual module context
      return `import { ${actor.name} as Actor${index} } from '${actor.path}';`;
    })
    .join('\n');

  // Generate actor registry entries: className -> ActorConstructor
  const registryEntries = threadConfig.actors
    .map((actor, index) => `  ${actor.name}: Actor${index}`)
    .join(',\n');

  // Generate actor metadata entries: className -> initialState
  const metadataEntries = threadConfig.actors
    .map((actor, index) => `  ${actor.name}: Actor${index}.initialState`)
    .join(',\n');

  return `/**
 * Auto-generated worker entry file for thread: ${threadId}
 * DO NOT EDIT - Generated from ensemble.json
 */

import { unpack } from 'msgpackr';
import WorkerBus from '@d-buckner/ensemble-core/worker/bus';
import WorkerRuntime from '@d-buckner/ensemble-core/worker/runtime';

// Actor imports
${actorImports}

// Actor registry: className -> ActorConstructor
const actorRegistry = {
${registryEntries}
};

// Actor metadata: className -> initialState (for dependency hydration)
const actorMetadata = {
${metadataEntries}
};

// Create worker infrastructure
const workerBus = new WorkerBus();
const workerRuntime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata);

// Message handler for commands from main thread
self.addEventListener('message', (event) => {
  try {
    const message = unpack(new Uint8Array(event.data));

    // Handle instantiation commands
    if (message.type === 'instantiate') {
      workerRuntime.instantiate(message).catch((error) => {
        console.error(\`Worker [${threadId}]: Failed to instantiate actor \${message.actorId}:\`, error);
      });
      return;
    }

    // Handle event/action messages (routed through WorkerBus)
    const { actorId, eventName, payload } = message;
    workerBus.emit(actorId, eventName, payload);
  } catch (error) {
    console.error('Worker [${threadId}]: Failed to handle message from main thread', error);
  }
});
`;
}
