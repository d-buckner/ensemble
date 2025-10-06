import { pack, unpack } from 'msgpackr';
import { ThreadBus } from './ThreadBus';
import type { WorkerRegistry } from '../threading/WorkerRegistry';
import type ActorSystem from '../core/ActorSystem';
import { MAIN_THREAD_ID } from '../constants';

/**
 * MainBus runs on the main thread and routes messages between:
 * 1. Actors local to the main thread
 * 2. Workers (for actors on worker threads)
 *
 * Queries ActorSystem for actor thread locations (single source of truth)
 */
export class MainBus extends ThreadBus {
  private actorSystem: ActorSystem;
  private workerRegistry: WorkerRegistry;

  constructor(
    actorSystem: ActorSystem,
    workerRegistry: WorkerRegistry
  ) {
    super();
    this.actorSystem = actorSystem;
    this.workerRegistry = workerRegistry;
  }

  protected post(actorId: string, eventName: string, payload: unknown): void {
    const actor = this.actorSystem.get(actorId);

    if (!actor) {
      console.warn(`MainBus: Actor ${actorId} not found in ActorSystem`);
      return;
    }

    const { threadId } = actor;

    // If actor is on main thread, local listeners already handled it
    if (threadId === MAIN_THREAD_ID) {
      return;
    }

    // Send to worker thread
    const worker = this.workerRegistry.get(threadId);
    if (!worker) {
      console.error(`MainBus: Worker not found for threadId ${threadId}`);
      return;
    }

    worker.postMessage(pack({
      actorId,
      eventName,
      payload,
    }));
  }

  /**
   * Handle incoming messages from workers
   */
  handleWorkerMessage(data: ArrayBuffer | Uint8Array): void {
    try {
      const { actorId, eventName, payload } = unpack(new Uint8Array(data));
      this.emit(actorId, eventName, payload);
    } catch (error) {
      console.error('MainBus: Failed to handle worker message', error);
    }
  }
}
