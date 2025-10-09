import { pack, unpack } from 'msgpackr';
import { MAIN_THREAD_ID } from '../constants';
import { Logger } from '../utils/Logger';
import { PROTOCOL_EVENTS } from './protocol-events';
import { ThreadBus } from './ThreadBus';
import type ActorSystem from '../core/ActorSystem';
import type { WorkerRegistry } from '../threading/WorkerRegistry';


export type EventType = 'state' | 'custom' | 'system';

export interface MessageWithTargets {
  actorId: string;
  eventName: string;
  timestamp: number;
  targets: string[];
  eventType: EventType;
}

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
  private mainMessageMonitor?: (event: MessageWithTargets) => void;

  constructor(
    actorSystem: ActorSystem,
    workerRegistry: WorkerRegistry
  ) {
    super();
    this.actorSystem = actorSystem;
    this.workerRegistry = workerRegistry;
  }

  setMainMessageMonitor(monitor: ((event: MessageWithTargets) => void) | undefined): void {
    this.mainMessageMonitor = monitor;
  }

  private determineEventType(actorId: string, eventName: string): EventType {
    // System events start with __
    if (eventName.startsWith('__')) {
      return 'system';
    }

    // Check if eventName is a state property
    const actor = this.actorSystem.get(actorId);
    if (actor) {
      const initialState = actor.actor.initialState;
      if (initialState && eventName in initialState) {
        return 'state';
      }
    }

    // Everything else is a custom event
    return 'custom';
  }

  private notifyMonitor(actorId: string, eventName: string): void {
    if (!this.mainMessageMonitor) return;

    // Get targets from ActorSystem dependency graph
    const actor = this.actorSystem.get(actorId);
    const targets = actor?.dependents.map(t => t.id) || [];

    // Determine event type
    const eventType = this.determineEventType(actorId, eventName);

    this.mainMessageMonitor({
      actorId,
      eventName,
      timestamp: Date.now(),
      targets,
      eventType,
    });
  }

  emit(actorId: string, eventName: string, payload: unknown): void {
    // Notify monitor with routing information
    this.notifyMonitor(actorId, eventName);

    // Call parent implementation
    super.emit(actorId, eventName, payload);
  }

  protected post(actorId: string, eventName: string, payload: unknown): void {
    const actor = this.actorSystem.get(actorId);

    if (!actor) {
      Logger.warn(`MainBus: Actor ${actorId} not found in ActorSystem`);
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
      Logger.error(`MainBus: Worker not found for threadId ${threadId}`);
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

      // Special handling for __state messages - route to ActorClient
      if (eventName === PROTOCOL_EVENTS.STATE) {
        const client = this.actorSystem.getClientByActorId(actorId);
        if (client) {
          client.hydrateState(payload);
          return;
        }

        Logger.warn(`MainBus: No client found for actor ${actorId} to hydrate state`);
        return;
      }

      Logger.debug(`[MainBus] Received event from worker: actorId=${actorId}, eventName=${eventName}`);

      // Notify monitor with routing information
      this.notifyMonitor(actorId, eventName);

      // Notify local listeners on main thread
      this.receive(actorId, eventName, payload);

      // Forward to dependent actors on other workers
      const actor = this.actorSystem.get(actorId);
      if (actor && actor.dependents) {
        Logger.debug(`[MainBus] Actor ${actorId} has ${actor.dependents.length} dependents:`, actor.dependents.map(d => `${d.id}@${this.actorSystem.get(d.id)?.threadId}`));
        for (const dependentToken of actor.dependents) {
          const dependent = this.actorSystem.get(dependentToken.id);
          if (dependent && dependent.threadId !== MAIN_THREAD_ID) {
            Logger.debug(`[MainBus] Forwarding event ${eventName} from ${actorId} to dependent ${dependentToken.id} on ${dependent.threadId}`);
            const worker = this.workerRegistry.get(dependent.threadId);
            if (worker) {
              worker.postMessage(pack({ actorId, eventName, payload }));
            } else {
              Logger.error(`[MainBus] No worker found for threadId ${dependent.threadId}`);
            }
          }
        }
      } else {
        Logger.debug(`[MainBus] Actor ${actorId} has no dependents or not found in ActorSystem`);
      }
    } catch (error) {
      Logger.error('MainBus: Failed to handle worker message', error);
    }
  }
}
