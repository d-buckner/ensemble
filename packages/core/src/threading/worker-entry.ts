import 'reflect-metadata';
import { unpack } from 'msgpackr';
import WorkerBus from '../messaging/WorkerBus';
import { Logger } from '../utils/Logger';

/**
 * Worker thread entry point
 * Handles incoming messages from main thread and routes to local actors
 */

const workerBus = new WorkerBus();

// Handle messages from main thread
self.addEventListener('message', (event) => {
  try {
    const { actorId, eventName, payload } = unpack(new Uint8Array(event.data));
    workerBus.emit(actorId, eventName, payload);
  } catch (error) {
    Logger.error('Worker: Failed to handle message from main thread', error);
  }
});

// Export workerBus for actor initialization
export { workerBus };
