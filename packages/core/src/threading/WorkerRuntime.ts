import { ActorClient } from '../core/ActorClient';
import { getEffectMetadata } from '../core/decorators';
import { ActorBus } from '../messaging/ActorBus';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';
import { Logger } from '../utils/Logger';
import type { Actor, ActorMetadata, ActorConstructor } from '../core/Actor';
import type { WithDeps } from '../core/ActorSystem';
import type { AllEvents } from '../messaging/types';
import type WorkerBus from '../messaging/WorkerBus';


export interface InstantiateCommand {
  type: 'instantiate';
  actorId: string;
  className: string;
  metadata: ActorMetadata;
  dependencies: Record<string, {
    actorId: string;
    className: string;
  }>;
}

/**
 * WorkerRuntime manages actor instances within a web worker
 */
export default class WorkerRuntime {
  private actors: Record<string, Actor> = {};
  private workerBus: WorkerBus;
  private actorRegistry: Record<string, ActorConstructor>;
  private actorMetadata: Record<string, Record<string, unknown>>;
  private clients: Map<string, ActorClient<any>> = new Map();

  constructor(
    workerBus: WorkerBus,
    actorRegistry: Record<string, ActorConstructor>,
    actorMetadata: Record<string, Record<string, unknown>>
  ) {
    this.workerBus = workerBus;
    this.actorRegistry = actorRegistry;
    this.actorMetadata = actorMetadata;
  }

  /**
   * Instantiate an actor in the worker
   */
  async instantiate(command: InstantiateCommand): Promise<void> {
    const { actorId, className, metadata, dependencies } = command;

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
    const actorInstance = new ActorClass();

    // Create actor bus
    const actorBus = new ActorBus<AllEvents<any, any>>(this.workerBus as any, actorId);

    // Initialize actor
    actorInstance.__init(actorBus, metadata);

    // Build dependencies map
    const deps: Record<string, ActorClient<any>> = {};
    for (const [depName, depInfo] of Object.entries(dependencies)) {
      // Check if we already have a client for this dependency
      let depClient = this.clients.get(depInfo.actorId);

      if (!depClient) {
        // Create ActorClient for dependency using metadata
        const depInitialState = this.actorMetadata[depInfo.className];
        if (!depInitialState) {
          throw new Error(`No metadata found for dependency: ${depInfo.className}`);
        }

        const depBus = new ActorBus<AllEvents<any, any>>(
          this.workerBus as any,
          depInfo.actorId
        );

        depClient = new ActorClient(depBus, depInitialState);
        this.clients.set(depInfo.actorId, depClient);
      }

      deps[depName] = depClient;
    }

    // Inject dependencies
    if (Object.keys(deps).length > 0) {
      (actorInstance as any as WithDeps<typeof deps>).deps = deps;
    }

    // Store instance
    this.actors[actorId] = actorInstance;

    // Setup effects - subscribe to dependency events
    this.setupEffects(actorInstance, ActorClass, deps);

    // Send initial state to main thread for ActorClient hydration
    // Use static initialState to avoid accessing actor's private state
    actorBus.emit(PROTOCOL_EVENTS.STATE as any, ActorClass.initialState);

    // Call lifecycle hook (access protected method via type assertion)
    await actorInstance.onInit?.call(actorInstance);
  }

  /**
   * Setup effect subscriptions for an actor
   */
  private setupEffects(
    actorInstance: Actor,
    ActorClass: ActorConstructor,
    deps: Record<string, ActorClient<any>>
  ): void {
    const effectMetadata = getEffectMetadata(ActorClass);

    for (const { methodName, eventSubscriptions } of effectMetadata) {
      for (const { actorClientKey, eventName } of eventSubscriptions) {
        const depClient = deps[actorClientKey];

        if (!depClient) {
          Logger.error(
            `Effect "${methodName}" references dependency "${actorClientKey}" which was not found in deps`
          );
          continue;
        }

        // Subscribe to the specific event on the dependency
        // Event name comes from decorator metadata and must be cast since depClient type is generic
        (depClient as any).on(eventName, (payload: unknown) => {
          // Execute the effect method on the actor (dynamic method access)
          const actor = actorInstance as unknown as Record<string, unknown>;
          if (typeof actor[methodName] === 'function') {
            (actor[methodName] as (payload: unknown) => void)(payload);
          }
        });
      }
    }
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
