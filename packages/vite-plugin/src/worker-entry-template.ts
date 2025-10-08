export const WORKER_ENTRY_TEMPLATE = `import { unpack } from 'msgpackr';
import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core';

// %ACTOR_IMPORTS%

const actorRegistry = {
  // %ACTOR_REGISTRY%
};

// Metadata for ALL actors in system (enables dependency injection)
const actorMetadata = {
  // %ACTOR_METADATA%
};

const workerBus = new WorkerBus();
const workerRuntime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata);

self.addEventListener('message', (event) => {
  try {
    const message = unpack(new Uint8Array(event.data));

    // Handle instantiation commands
    if (message.type === 'instantiate') {
      workerRuntime.instantiate(message).catch((error) => {
        console.error(\`Worker: Failed to instantiate actor \${message.actorId}:\`, error);
      });
      return;
    }

    // Handle regular event messages from MainBus
    if (message.actorId && message.eventName) {
      const { actorId, eventName, payload } = message;
      workerBus.receive(actorId, eventName, payload);
      return;
    }

    console.warn('Worker: Unknown message format', message);
  } catch (error) {
    console.error('Worker: Failed to handle message from main thread', error);
  }
});

export { workerBus, workerRuntime, actorRegistry };
`;
