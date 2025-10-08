/**
 * ActorSystem is the truth for the Actor topology
 */

import type { Actor, ActorMetadata } from './Actor';
import { WorkerRegistry } from '../threading/WorkerRegistry';
import { MAIN_THREAD_ID } from '../constants';
import { MainBus } from '../messaging/MainBus';
import { ActorBus } from '../messaging/ActorBus';
import { ActorClient } from './ActorClient';
import { getEffectMetadata, getThreadMetadata } from './decorators';
import type { AllEvents } from '../messaging/types';
import type { ActorToken } from './ActorToken';
import { pack } from 'msgpackr';
import type { InstantiateCommand } from '../threading/WorkerRuntime';

// Extract options type from Actor constructor
type OptionsOf<T> = T extends new (options: infer O) => any ? O : never;

// Registration interface for actor instances
export interface ActorRegistration<T extends Actor = any> {
  token: ActorToken<T>;
  actor: new (options: OptionsOf<T>) => T;
  options: OptionsOf<T>;
  dependencies?: Record<string, ActorToken<any>>; // { depName: token }
}

// Internal node representation in the graph
interface Node<T extends Actor = any> extends ActorRegistration<T> {
  threadId: string; // Extracted from @thread decorator or defaults to MAIN_THREAD_ID
  dependents: ActorToken<T>[];
}

interface Graph {
  [actorId: string]: Node;
}


export interface ActorSystemOptions {
  workerOutput?: string;
}

export default class ActorSystem {
  private graph: Graph = {};
  private workerRegistry: WorkerRegistry;
  private mainBus?: MainBus;
  private instances: Map<symbol, Actor> = new Map();
  private clients: Map<symbol, ActorClient<any>> = new Map();

  constructor(options: ActorSystemOptions = {}) {
    this.workerRegistry = new WorkerRegistry(options.workerOutput);
  }

  register(registration: ActorRegistration): void {
    const { token, actor, options, dependencies = {} } = registration;

    if (this.graph[token.id]) {
      throw new Error(`Cannot register actor that is already registered: ${token.id}`);
    }

    // Extract threadId from @thread decorator, default to MAIN_THREAD_ID
    const threadId = getThreadMetadata(actor) ?? MAIN_THREAD_ID;

    // Validate all dependency instances exist already
    Object.values(dependencies).forEach(depToken => {
      if (!this.graph[depToken.id]) {
        throw new Error(`Cannot register actor before its dependencies: ${token.id} depends on ${depToken.id}`);
      }

      // Track this actor as a dependent
      this.graph[depToken.id].dependents.push(token);
    });

    this.graph[token.id] = {
      token,
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
    const node = this.graph[actorId];
    if (!node) {
      throw new Error(`Actor ${actorId} not found in graph`);
    }

    const { token, actor: ActorClass, options, threadId, dependencies = {} } = node;

    // Skip if already instantiated
    if (this.instances.has(token.symbol)) {
      return;
    }

    // Create metadata
    const metadata: ActorMetadata = {
      id: actorId,
      name: ActorClass.name,
      threadId,
      dependencies: Object.values(dependencies).map(t => t.id),
    };

    // Handle worker thread actors
    if (threadId !== MAIN_THREAD_ID) {

      // Get worker for this thread
      const worker = this.workerRegistry.get(threadId);
      if (!worker) {
        throw new Error(`Worker not found for threadId: ${threadId}`);
      }

      // Send instantiation command to worker (only serializable data)
      const command: InstantiateCommand = {
        type: 'instantiate',
        actorId,
        className: ActorClass.name,
        options,
        metadata: {
          id: metadata.id,
          name: metadata.name,
          threadId: metadata.threadId,
          dependencies: metadata.dependencies,
        },
      };

      worker.postMessage(pack(command));

      // Create actor bus for communication with worker
      const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);

      // Create ActorClient with empty state shape
      // Worker will send initial state via __state message after instantiation
      const client = new ActorClient(actorBus, {} as any, ActorClass);
      this.clients.set(token.symbol, client);

      return;
    }

    // Create actor instance for main thread
    const actorInstance = new ActorClass(options);

    // Create actor bus with proper typing
    const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);

    // Initialize actor
    actorInstance.__init(actorBus, metadata);

    // Build dependencies map
    const deps: Record<string, ActorClient<any>> = {};
    for (const [depName, depToken] of Object.entries(dependencies)) {
      const depClient = this.clients.get(depToken.symbol);
      if (!depClient) {
        throw new Error(`Dependency ${depToken.id} not instantiated for actor ${actorId}`);
      }
      deps[depName] = depClient;
    }

    // Inject dependencies
    if (Object.keys(deps).length > 0) {
      // Type-safe dependency injection via index signature
      (actorInstance as unknown as { deps: Record<string, ActorClient<any>> }).deps = deps;
    }

    // Store instance
    this.instances.set(token.symbol, actorInstance);

    // Create and store ActorClient with state shape
    const client = new ActorClient(actorBus, actorInstance.state, ActorClass);
    this.clients.set(token.symbol, client);

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
   * The actor type is automatically inferred from the token.
   */
  getClient<T extends Actor>(token: ActorToken<T>): ActorClient<T> | null {
    const client = this.clients.get(token.symbol);
    return client ? (client as ActorClient<T>) : null;
  }

  /**
   * Get an ActorClient by actorId (internal use)
   */
  getClientByActorId(actorId: string): ActorClient<any> | null {
    const node = this.graph[actorId];
    if (!node) return null;

    const client = this.clients.get(node.token.symbol);
    return client || null;
  }
}
