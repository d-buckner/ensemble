import type { Actor, ActorMetadata } from '../core/Actor';
import type WorkerBus from '../messaging/WorkerBus';
import { ActorBus } from '../messaging/ActorBus';
import type { AllEvents } from '../messaging/types';

export interface InstantiateCommand {
  type: 'instantiate',
  actorId: string;
  className: string;
  options: any;
  metadata: ActorMetadata;
}

/**
 * WorkerRuntime manages actor instances within a web worker
 */
export default class WorkerRuntime {
  private actors: Record<string, Actor> = {};
  private workerBus: WorkerBus;
  private actorRegistry: Record<string, new (...args: any[]) => Actor>;

  constructor(
    workerBus: WorkerBus,
    actorRegistry: Record<string, new (...args: any[]) => Actor>
  ) {
    this.workerBus = workerBus;
    this.actorRegistry = actorRegistry;
  }

  /**
   * Instantiate an actor in the worker
   */
  async instantiate(command: InstantiateCommand): Promise<void> {
    const { actorId, className, options, metadata } = command;

    // Check if already instantiated
    if (this.actors[actorId]) {
      throw new Error(`Actor already instantiated: ${actorId}`);
    }

    // Look up actor class in registry
    const ActorClass = this.actorRegistry[className];
    if (!ActorClass) {
      throw new Error(`Actor class not found in registry: ${className}`);
    }

    // Create actor instance
    const actorInstance = new ActorClass(options);

    // Create actor bus
    const actorBus = new ActorBus<AllEvents<any, any>>(this.workerBus as any, actorId);

    // Initialize actor
    actorInstance.__init(actorBus, metadata);

    // Store instance
    this.actors[actorId] = actorInstance;

    // Send initial state to main thread for ActorClient hydration
    actorBus.emit('__state', actorInstance.state);

    // Call lifecycle hook (access protected method via type assertion)
    await actorInstance.onInit?.call(actorInstance);
  }

  /**
   * Route an action invocation to an actor instance
   */
  handleEvent(actorId: string, method: string, args: unknown[]): void {
    const actor = this.actors[actorId];
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    actor.bus.emit(method, args);
  }

  /**
   * Get an actor instance by ID (for testing)
   */
  getActor(actorId: string): Actor | undefined {
    return this.actors[actorId];
  }
}
