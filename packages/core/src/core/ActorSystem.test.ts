import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Actor } from './Actor';
import ActorSystem from './ActorSystem';
import { createActorToken } from './ActorToken';
import { ThreadContext } from './ThreadContext';
import type { ActorToken } from './ActorToken';


// Mock the virtual manifest module
vi.mock('virtual:worker-manifest', () => ({
  WORKER_PATHS: {}
}));

// Mock Worker class
class MockWorker {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  public postMessage = vi.fn();
  public url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(event: string, callback: (event: MessageEvent) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  removeEventListener(event: string, callback: (event: MessageEvent) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  terminate(): void {
    this.listeners.clear();
  }
}

// Mock actor classes for testing
interface MockState extends Record<string, unknown> {
  value: number;
}

class MockActor extends Actor<MockState> {
  static readonly initialState: MockState = { value: 0 };

  constructor() {
    super(MockActor.initialState);
  }
}

class DependentActor extends Actor<MockState> {
  static readonly initialState: MockState = { value: 0 };

  constructor() {
    super(DependentActor.initialState);
  }
}

describe('ActorSystem', () => {
  let system: ActorSystem;
  let mockToken: ActorToken<MockActor>;
  let dependentToken: ActorToken<DependentActor>;
  let originalWorker: typeof Worker;

  beforeEach(() => {
    // Reset ThreadContext before each test (system.start() will initialize it)
    ThreadContext.reset();

    system = new ActorSystem();
    mockToken = createActorToken<MockActor>('mock');
    dependentToken = createActorToken<DependentActor>('dependent');

    // Mock global Worker
    originalWorker = globalThis.Worker;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    // Restore original Worker
    globalThis.Worker = originalWorker;
  });

  describe('register', () => {
    it('should register an actor without dependencies', async () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      await system.start();

      const client = system.getClient(mockToken);
      expect(client).not.toBeNull();
      expect(client?.state.value).toBe(0);
    });

    it('should register an actor with dependencies', async () => {
      // Register dependency first
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      // Register dependent actor
      system.register({
        token: dependentToken,
        actor: DependentActor,
        dependencies: {
          mockActor: mockToken,
        },
      });

      await system.start();

      const client = system.getClient(dependentToken);
      expect(client).not.toBeNull();
      expect(client?.state.value).toBe(0);
    });

    it('should throw when registering an actor that already exists', () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      expect(() =>
        system.register({
          token: mockToken,
          actor: MockActor,
        })
      ).toThrow('Cannot register actor that is already registered: mock');
    });

    it('should throw when registering an actor before its dependencies', () => {
      expect(() =>
        system.register({
          token: dependentToken,
          actor: DependentActor,
          dependencies: {
            mockActor: mockToken,
          },
        })
      ).toThrow('Cannot register actor before its dependencies: dependent depends on mock');
    });
  });

  describe('getClient', () => {
    it('should return a client after system start', async () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      await system.start();

      const client = system.getClient(mockToken);
      expect(client).not.toBeNull();
      expect(client?.state).toBeDefined();
    });

    it('should return null for non-existent actor', async () => {
      const nonExistentToken = createActorToken<MockActor>('non-existent');
      await system.start();

      const client = system.getClient(nonExistentToken);
      expect(client).toBeNull();
    });
  });

  describe('start', () => {
    it('should instantiate all registered actors', async () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      system.register({
        token: dependentToken,
        actor: DependentActor,
      });

      await system.start();

      const client1 = system.getClient(mockToken);
      const client2 = system.getClient(dependentToken);

      expect(client1).not.toBeNull();
      expect(client2).not.toBeNull();
    });

    it('should send instantiation commands for worker thread actors', async () => {
      const workerToken = createActorToken<MockActor>('worker-actor');

      system.register({
        token: workerToken,
        actor: MockActor,
      });

      await system.start();

      // Worker actors should create a client but not instantiate locally
      const client = system.getClient(workerToken);
      expect(client).not.toBeNull();
    });

    it('should throw when starting with a simple two-node cycle', async () => {
      const actorAToken = createActorToken<MockActor>('actor-a');
      const actorBToken = createActorToken<DependentActor>('actor-b');

      // Create cycle: A -> B, B -> A
      // First register A (no dependencies yet)
      system.register({
        token: actorAToken,
        actor: MockActor,
      });

      // Register B depending on A
      system.register({
        token: actorBToken,
        actor: DependentActor,
        dependencies: { actorA: actorAToken },
      });

      // Manually create cycle by modifying graph (since registration prevents it)
      const nodeA = system.get(actorAToken.id);
      if (nodeA) {
        nodeA.dependencies = { actorB: actorBToken };
      }

      await expect(system.start()).rejects.toThrow(/Cycle detected in actor dependencies/);
    });

    it('should throw when starting with a three-node cycle', async () => {
      const actorAToken = createActorToken<MockActor>('actor-a');
      const actorBToken = createActorToken<DependentActor>('actor-b');
      const actorCToken = createActorToken<MockActor>('actor-c');

      // Register all actors
      system.register({
        token: actorAToken,
        actor: MockActor,
      });

      system.register({
        token: actorBToken,
        actor: DependentActor,
      });

      system.register({
        token: actorCToken,
        actor: MockActor,
      });

      // Manually create cycle: A -> B -> C -> A
      const nodeA = system.get(actorAToken.id);
      const nodeB = system.get(actorBToken.id);
      const nodeC = system.get(actorCToken.id);

      if (nodeA && nodeB && nodeC) {
        nodeA.dependencies = { actorB: actorBToken };
        nodeB.dependencies = { actorC: actorCToken };
        nodeC.dependencies = { actorA: actorAToken };
      }

      await expect(system.start()).rejects.toThrow(/Cycle detected in actor dependencies/);
    });

    it('should throw with helpful cycle path in error message', async () => {
      const actorAToken = createActorToken<MockActor>('actor-a');
      const actorBToken = createActorToken<DependentActor>('actor-b');

      system.register({
        token: actorAToken,
        actor: MockActor,
      });

      system.register({
        token: actorBToken,
        actor: DependentActor,
      });

      // Create cycle: A -> B -> A
      const nodeA = system.get(actorAToken.id);
      const nodeB = system.get(actorBToken.id);

      if (nodeA && nodeB) {
        nodeA.dependencies = { actorB: actorBToken };
        nodeB.dependencies = { actorA: actorAToken };
      }

      await expect(system.start()).rejects.toThrow(/actor-a -> actor-b -> actor-a/);
    });

    it('should not throw for valid acyclic dependency graph', async () => {
      const actorAToken = createActorToken<MockActor>('actor-a');
      const actorBToken = createActorToken<DependentActor>('actor-b');
      const actorCToken = createActorToken<MockActor>('actor-c');

      // Create valid DAG: C <- B <- A (A depends on B, B depends on C)
      system.register({
        token: actorCToken,
        actor: MockActor,
      });

      system.register({
        token: actorBToken,
        actor: DependentActor,
        dependencies: { actorC: actorCToken },
      });

      system.register({
        token: actorAToken,
        actor: MockActor,
        dependencies: { actorB: actorBToken },
      });

      // Should not throw
      await expect(system.start()).resolves.not.toThrow();
    });
  });

  describe('message monitoring', () => {
    it('should allow setting a message monitor', async () => {
      const monitor = vi.fn();

      system.register({
        token: mockToken,
        actor: MockActor,
      });

      await system.start();
      system.setMessageMonitor(monitor);

      // Message monitor is set but won't be called until events are emitted
      expect(() => system.setMessageMonitor(monitor)).not.toThrow();
    });

    it('should allow clearing a message monitor', async () => {
      const monitor = vi.fn();

      system.register({
        token: mockToken,
        actor: MockActor,
      });

      await system.start();
      system.setMessageMonitor(monitor);
      system.setMessageMonitor(undefined);

      expect(() => system.setMessageMonitor(undefined)).not.toThrow();
    });

    it('should not throw when setting monitor before system start', () => {
      const monitor = vi.fn();

      system.register({
        token: mockToken,
        actor: MockActor,
      });

      // Should not throw even though mainBus is not yet created
      expect(() => system.setMessageMonitor(monitor)).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should dispose all clients and clear collections', async () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      system.register({
        token: dependentToken,
        actor: DependentActor,
      });

      await system.start();

      const client1 = system.getClient(mockToken);
      const client2 = system.getClient(dependentToken);

      expect(client1).not.toBeNull();
      expect(client2).not.toBeNull();

      await system.shutdown();

      // Clients should be cleared
      expect(system.getClient(mockToken)).toBeNull();
      expect(system.getClient(dependentToken)).toBeNull();
    });

    it('should call onDestroy lifecycle hooks', async () => {
      const onDestroySpy = vi.fn();

      class LifecycleActor extends Actor<MockState> {
        static readonly initialState: MockState = { value: 0 };

        constructor() {
          super(LifecycleActor.initialState);
        }

        onDestroy(): void {
          onDestroySpy();
        }
      }

      const lifecycleToken = createActorToken<LifecycleActor>('lifecycle');

      system.register({
        token: lifecycleToken,
        actor: LifecycleActor,
      });

      await system.start();
      await system.shutdown();

      expect(onDestroySpy).toHaveBeenCalledOnce();
    });

    it('should support multiple start/shutdown cycles', async () => {
      system.register({
        token: mockToken,
        actor: MockActor,
      });

      // First cycle
      await system.start();
      expect(system.getClient(mockToken)).not.toBeNull();
      await system.shutdown();
      expect(system.getClient(mockToken)).toBeNull();

      // Second cycle
      await system.start();
      expect(system.getClient(mockToken)).not.toBeNull();
      await system.shutdown();
      expect(system.getClient(mockToken)).toBeNull();
    });
  });
});
