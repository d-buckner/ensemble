import { unpack } from 'msgpackr';
import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core';
import type { InstantiateCommand } from '@d-buckner/ensemble-core';

// %ACTOR_IMPORTS%

const actorRegistry = {
  // %ACTOR_REGISTRY%
};

const workerBus = new WorkerBus();
const workerRuntime = new WorkerRuntime(workerBus, actorRegistry);

self.addEventListener('message', (event) => {
  try {
    const message = unpack(new Uint8Array(event.data));

    // Handle instantiation commands
    if (message.type === 'instantiate') {
      const command = message as InstantiateCommand & { type: 'instantiate' };
      workerRuntime.instantiate(command).catch((error) => {
        console.error(`Worker: Failed to instantiate actor ${command.actorId}:`, error);
      });
      return;
    }

    const { actorId, method, args } = message;
    workerRuntime.handleEvent(actorId, method, args);
  } catch (error) {
    console.error('Worker: Failed to handle message from main thread', error);
  }
});

export { workerBus, workerRuntime, actorRegistry };
