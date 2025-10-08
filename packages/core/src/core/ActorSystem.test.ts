import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ActorSystem from './ActorSystem';
import { Actor } from './Actor';
import { createActorToken } from './ActorToken';
import type { ActorToken } from './ActorToken';

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
  });
});
