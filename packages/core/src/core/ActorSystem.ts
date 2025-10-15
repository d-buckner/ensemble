/**
 * ActorSystem is the truth for the Actor topology
 */

import { pack } from 'msgpackr';
import { MAIN_THREAD_ID } from '../constants';
import { ActorBus } from '../messaging/ActorBus';
import { MainBus } from '../messaging/MainBus';
import { ThreadStateCoordinator } from '../messaging/ThreadStateCoordinator';
import { ThreadContext } from './ThreadContext';
import { WorkerRegistry } from '../threading/WorkerRegistry';
import { AsyncActorClient } from './ActorClient';
import { SyncActorClient } from './SyncActorClient';
import { getThreadMetadata } from './decorators';
import type { Actor, ActorMetadata, ActorConstructor } from './Actor';
import type { ActorToken } from './ActorToken';
import type { IActorClient } from './types';
import type { AllEvents } from '../messaging/types';
import type { InstantiateCommand } from '../threading/WorkerRuntime';


// Registration interface for actor instances
export interface ActorRegistration<T extends Actor = any> {
  token: ActorToken<T>;
  actor: ActorConstructor<T>;
  dependencies?: Record<string, ActorToken<any>>; // { depName: token }
}

// Internal node representation in the graph
interface Node<T extends Actor = any> extends ActorRegistration<T> {
  threadId: string; // Extracted from @thread decorator or defaults to MAIN_THREAD_ID
  className: string; // Stored before minification for worker instantiation
  dependents: ActorToken<T>[];
}

interface Graph {
  [actorId: string]: Node;
}

// Type helper for dependency injection
export type WithDeps<TDeps extends Record<string, IActorClient<any>>> = {
  deps: TDeps;
};

export default class ActorSystem {
  private graph: Graph = {};
  private workerRegistry: WorkerRegistry;
  private mainBus?: MainBus;
  private instances: Map<symbol, Actor> = new Map();
  private clients: Map<symbol, IActorClient<any>> = new Map();
  private threadsToRegister: Set<string> = new Set();

  constructor() {
    this.workerRegistry = new WorkerRegistry();
  }

  register(registration: ActorRegistration): void {
    const { token, actor, dependencies = {} } = registration;

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
      className: actor.name, // Capture before minification
      dependencies,
      dependents: [],
    };

    // Track threads that need workers (will be registered during start())
    if (threadId !== MAIN_THREAD_ID) {
      this.threadsToRegister.add(threadId);
    }
  }

  get(actorId: string): Node | null {
    return this.graph[actorId] ?? null;
  }

  /**
   * Get all actor IDs in the system
   */
  getAllActorIds(): string[] {
    return Object.keys(this.graph);
  }

  /**
   * Validate that the actor dependency graph has no cycles
   * @throws Error if a cycle is detected
   */
  private validateAcyclic(): void {
    const visited = new Map<string, 'unvisited' | 'visiting' | 'visited'>();

    // Initialize all nodes as unvisited
    for (const actorId of Object.keys(this.graph)) {
      visited.set(actorId, 'unvisited');
    }

    // DFS from each unvisited node
    for (const actorId of Object.keys(this.graph)) {
      if (visited.get(actorId) === 'unvisited') {
        this.dfsCheckCycle(actorId, visited, []);
      }
    }
  }

  /**
   * DFS helper for cycle detection
   */
  private dfsCheckCycle(
    actorId: string,
    visited: Map<string, 'unvisited' | 'visiting' | 'visited'>,
    path: string[]
  ): void {
    visited.set(actorId, 'visiting');
    path.push(actorId);

    const node = this.graph[actorId];
    if (!node) {
      return;
    }

    // Check all dependencies
    const dependencies = node.dependencies || {};
    for (const depToken of Object.values(dependencies)) {
      const depId = depToken.id;
      const depState = visited.get(depId);

      if (depState === 'visiting') {
        // Found a cycle - build error message with cycle path
        const cycleStart = path.indexOf(depId);
        const cycle = [...path.slice(cycleStart), depId];
        throw new Error(
          `Cycle detected in actor dependencies: ${cycle.join(' -> ')}`
        );
      }

      if (depState === 'unvisited') {
        this.dfsCheckCycle(depId, visited, path);
      }
    }

    visited.set(actorId, 'visited');
    path.pop();
  }

  /**
   * Start the actor system - instantiate all registered actors
   */
  async start(): Promise<void> {
    // Validate no cycles in dependency graph
    this.validateAcyclic();

    // Initialize thread context for main thread
    // Fail fast if already initialized (indicates double-start or multiple systems)
    const coordinator = new ThreadStateCoordinator();
    ThreadContext.initialize(coordinator);

    // Load worker manifest and register workers
    if (this.threadsToRegister.size > 0) {
      for (const threadId of this.threadsToRegister) {
        this.workerRegistry.add(threadId);
      }
    }

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
   * Shutdown the actor system - cleanup all resources
   */
  async shutdown(): Promise<void> {
    // Call onDestroy lifecycle hooks
    for (const instance of this.instances.values()) {
      if (instance.onDestroy) {
        await instance.onDestroy();
      }
    }

    // Dispose all clients
    for (const client of this.clients.values()) {
      client.dispose();
    }

    // Clear collections
    this.instances.clear();
    this.clients.clear();

    // Terminate workers
    this.workerRegistry.terminateAll();

    // Clear main bus
    this.mainBus = undefined;

    // Reset thread context (for testing)
    ThreadContext.reset();
  }

  /**
   * Instantiate a single actor and its dependencies
   */
  private async instantiateActor(actorId: string): Promise<void> {
    const node = this.graph[actorId];
    if (!node) {
      throw new Error(`Actor ${actorId} not found in graph`);
    }

    const { token, actor: ActorClass, threadId, dependencies = {} } = node;

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

      // Build dependency metadata
      const dependencyMetadata: Record<string, { actorId: string; className: string }> = {};
      for (const [depName, depToken] of Object.entries(dependencies)) {
        const depNode = this.graph[depToken.id];
        if (!depNode) {
          throw new Error(`Dependency ${depToken.id} not found in graph`);
        }
        dependencyMetadata[depName] = {
          actorId: depToken.id,
          className: depNode.className
        };
      }

      // Send instantiation command to worker (only serializable data)
      const command: InstantiateCommand = {
        type: 'instantiate',
        actorId,
        className: node.className,
        metadata: {
          id: metadata.id,
          name: metadata.name,
          threadId: metadata.threadId,
          dependencies: metadata.dependencies,
        },
        dependencies: dependencyMetadata,
      };

      worker.postMessage(pack(command));

      // Create actor bus for communication with worker
      const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);

      // Create AsyncActorClient with initial state from static property
      // Worker will send updated state via __state message after instantiation
      const client = new AsyncActorClient(actorBus, ActorClass.initialState);
      this.clients.set(token.symbol, client);

      return;
    }

    // Create actor instance for main thread
    const actorInstance = new ActorClass();

    // Initialize actor (no bus needed for main-thread actors)
    actorInstance.__init(metadata);

    // Build dependencies map
    const deps: Record<string, IActorClient<any>> = {};
    for (const [depName, depToken] of Object.entries(dependencies)) {
      const depClient = this.clients.get(depToken.symbol);
      if (!depClient) {
        throw new Error(`Dependency ${depToken.id} not instantiated for actor ${actorId}`);
      }
      deps[depName] = depClient;
    }

    // Inject dependencies
    if (Object.keys(deps).length > 0) {
      (actorInstance as unknown as WithDeps<typeof deps>).deps = deps;
    }

    // Store instance
    this.instances.set(token.symbol, actorInstance);

    // Create and store SyncActorClient (handles effects internally)
    const client = new SyncActorClient(actorInstance, deps, ActorClass);
    this.clients.set(token.symbol, client);

    // Call lifecycle hook
    if (actorInstance.onInit) {
      await actorInstance.onInit();
    }
  }

  /**
   * Get an ActorClient for a registered actor (for external consumers)
   * The actor type is automatically inferred from the token.
   * Returns the appropriate client type (SyncActorClient or AsyncActorClient)
   */
  getClient<T extends Actor>(token: ActorToken<T>): IActorClient<T> | null {
    const client = this.clients.get(token.symbol);
    return client ? (client as IActorClient<T>) : null;
  }

  /**
   * Get an ActorClient by actorId (internal use)
   */
  getClientByActorId(actorId: string): IActorClient<any> | null {
    const node = this.graph[actorId];
    if (!node) return null;

    const client = this.clients.get(node.token.symbol);
    return client || null;
  }

  /**
   * Set a message monitor to observe all messages flowing through the system
   * Used for debugging, visualization, and devtools
   */
  setMessageMonitor(monitor: ((event: any) => void) | undefined): void {
    this.mainBus?.setMainMessageMonitor(monitor);
  }
}
