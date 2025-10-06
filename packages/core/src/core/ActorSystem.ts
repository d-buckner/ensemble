/**
 * ActorSystem is the truth for the Actor topology
 */

import type { Actor, ActorMetadata } from './Actor';
import { WorkerRegistry } from '../threading/WorkerRegistry';
import { MAIN_THREAD_ID } from '../constants';
import { MainBus } from '../messaging/MainBus';
import { ActorBus } from '../messaging/ActorBus';
import { ActorClient } from './ActorClient';
import { getEffectMetadata } from './decorators';
import type { AllEvents } from '../messaging/types';

// Extract options type from Actor constructor
type OptionsOf<T> = T extends new (options: infer O) => any ? O : never;

// Registration interface for actor instances
export interface ActorRegistration<T extends Actor = any> {
  id: string;
  actor: new (options: OptionsOf<T>) => T;
  threadId: string;
  options: OptionsOf<T>;
  dependencies?: Record<string, string>; // { depName: instanceId }
}

// Internal node representation in the graph
interface Node extends ActorRegistration {
  dependents: string[];
}

interface Graph {
  [actorId: string]: Node;
}


export default class ActorSystem {
  private graph: Graph = {};
  private workerRegistry: WorkerRegistry = new WorkerRegistry();
  private mainBus?: MainBus;
  private instances: Map<string, Actor> = new Map();
  private clients: Map<string, ActorClient<any>> = new Map();

  register(registration: ActorRegistration): void {
    const { id, actor, threadId, options, dependencies = {} } = registration;

    if (this.graph[id]) {
      throw new Error(`Cannot register actor that is already registered: ${id}`);
    }

    // Validate all dependency instances exist already
    Object.values(dependencies).forEach(depId => {
      if (!this.graph[depId]) {
        throw new Error(`Cannot register actor before its dependencies: ${id} depends on ${depId}`);
      }

      // Track this actor as a dependent
      this.graph[depId].dependents.push(id);
    });

    this.graph[id] = {
      id,
      actor,
      threadId,
      options,
      dependencies,
      dependents: [],
    };

    // Only add to worker registry if not the main thread
    if (threadId !== MAIN_THREAD_ID && !this.workerRegistry.has(threadId)) {
      this.workerRegistry.add(threadId);
    }
  }

  get(actorId: string): Node | null {
    return this.graph[actorId] ?? null;
  }

  /**
   * Start the actor system - instantiate all registered actors
   */
  async start(): Promise<void> {
    // Create main bus
    this.mainBus = new MainBus(this, this.workerRegistry);

    // Set up worker message handler
    this.workerRegistry.setMessageHandler((data) => {
      this.mainBus!.handleWorkerMessage(data);
    });

    // Get actors in dependency order (already guaranteed by registration)
    const actorIds = Object.keys(this.graph);

    // Instantiate each actor
    for (const actorId of actorIds) {
      await this.instantiateActor(actorId);
    }
  }

  /**
   * Instantiate a single actor and its dependencies
   */
  private async instantiateActor(actorId: string): Promise<void> {
    // Skip if already instantiated
    if (this.instances.has(actorId)) {
      return;
    }

    const node = this.graph[actorId];
    if (!node) {
      throw new Error(`Actor ${actorId} not found in graph`);
    }

    const { actor: ActorClass, options, threadId, dependencies = {} } = node;

    // Create actor instance
    const actorInstance = new ActorClass(options);

    // Create actor bus with proper typing
    const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);

    // Create metadata
    const metadata: ActorMetadata = {
      id: actorId,
      name: ActorClass.name,
      threadId,
      dependencies: Object.values(dependencies),
    };

    // Initialize actor
    actorInstance.__init(actorBus, metadata);

    // Build dependencies map
    const deps: Record<string, ActorClient<any>> = {};
    for (const [depName, depId] of Object.entries(dependencies)) {
      const depClient = this.clients.get(depId);
      if (!depClient) {
        throw new Error(`Dependency ${depId} not instantiated for actor ${actorId}`);
      }
      deps[depName] = depClient;
    }

    // Inject dependencies
    if (Object.keys(deps).length > 0) {
      // Type-safe dependency injection via index signature
      (actorInstance as unknown as { deps: Record<string, ActorClient<any>> }).deps = deps;
    }

    // Store instance
    this.instances.set(actorId, actorInstance);

    // Create and store ActorClient
    const client = new ActorClient(actorBus, actorInstance.state, ActorClass);
    this.clients.set(actorId, client);

    // Setup effects - subscribe to dependency events
    this.setupEffects(actorInstance, ActorClass, deps);

    // Call lifecycle hook
    if (actorInstance.onInit) {
      await actorInstance.onInit();
    }
  }

  /**
   * Setup effect subscriptions for an actor
   */
  private setupEffects(
    actorInstance: Actor,
    ActorClass: new (...args: any[]) => Actor,
    deps: Record<string, ActorClient<any>>
  ): void {
    const effectMetadata = getEffectMetadata(ActorClass);

    for (const { methodName, eventSubscriptions } of effectMetadata) {
      for (const { actorClientKey, eventName } of eventSubscriptions) {
        const depClient = deps[actorClientKey];

        if (!depClient) {
          console.error(
            `Effect "${methodName}" references dependency "${actorClientKey}" which was not found in deps`
          );
          continue;
        }

        // Subscribe to the specific event on the dependency
        depClient.on(eventName as string | number, () => {
          // Execute the effect method on the actor (dynamic method access)
          const actor = actorInstance as unknown as Record<string, unknown>;
          if (typeof actor[methodName] === 'function') {
            (actor[methodName] as () => void)();
          }
        });
      }
    }
  }

  /**
   * Get an ActorClient for a registered actor (for external consumers)
   */
  getClient<T extends Actor>(actorId: string): ActorClient<T> | null {
    return this.clients.get(actorId) ?? null;
  }
}
