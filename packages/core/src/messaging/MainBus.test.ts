import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainBus } from './MainBus';
import type ActorSystem from '../core/ActorSystem';
import type { WorkerRegistry } from '../threading/WorkerRegistry';
import { MAIN_THREAD_ID } from '../constants';

// Mock msgpackr
vi.mock('msgpackr', () => ({
  pack: vi.fn((data) => {
    const str = JSON.stringify(data);
    return new TextEncoder().encode(str);
  }),
  unpack: vi.fn((data) => {
    const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
    const str = new TextDecoder().decode(uint8Array);
    return JSON.parse(str);
  }),
}));

import { pack, unpack } from 'msgpackr';

// Mock ActorSystem
class MockActorSystem {
  private actors = new Map<string, { threadId: string }>();

  get(actorId: string): { threadId: string } | null {
    return this.actors.get(actorId) ?? null;
  }

  setActor(actorId: string, threadId: string): void {
    this.actors.set(actorId, { threadId });
  }
}

// Mock WorkerRegistry
class MockWorkerRegistry {
  private workers = new Map<string, { postMessage: ReturnType<typeof vi.fn> }>();

  get(threadId: string): { postMessage: ReturnType<typeof vi.fn> } | null {
    return this.workers.get(threadId) ?? null;
  }

  setWorker(threadId: string, worker: { postMessage: ReturnType<typeof vi.fn> }): void {
    this.workers.set(threadId, worker);
  }
}

describe('MainBus', () => {
  let actorSystem: MockActorSystem;
  let workerRegistry: MockWorkerRegistry;
  let mainBus: MainBus;

  beforeEach(() => {
    actorSystem = new MockActorSystem();
    workerRegistry = new MockWorkerRegistry();
    mainBus = new MainBus(
      actorSystem as unknown as ActorSystem,
      workerRegistry as unknown as WorkerRegistry
    );

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('post()', () => {
    it('should not post if actor not found in ActorSystem', () => {
      // Don't set up any actors
      const callback = vi.fn();
      mainBus.on('unknown-actor', 'testEvent', callback);

      mainBus.emit('unknown-actor', 'testEvent', 'payload');

      expect(pack).not.toHaveBeenCalled();
    });

    it('should not post if actor is on main thread', () => {
      actorSystem.setActor('main-actor', MAIN_THREAD_ID);

      const callback = vi.fn();
      mainBus.on('main-actor', 'testEvent', callback);

      mainBus.emit('main-actor', 'testEvent', 'payload');

      // Local callback should be invoked
      expect(callback).toHaveBeenCalledWith('payload');

      // But should not pack/post to worker
      expect(pack).not.toHaveBeenCalled();
    });

    it('should post to worker if actor is on worker thread', () => {
      const mockWorker = { postMessage: vi.fn() };

      actorSystem.setActor('worker-actor', 'worker-1');
      workerRegistry.setWorker('worker-1', mockWorker);

      mainBus.emit('worker-actor', 'testEvent', { data: 'value' });

      expect(pack).toHaveBeenCalledWith({
        actorId: 'worker-actor',
        eventName: 'testEvent',
        payload: { data: 'value' },
      });

      expect(mockWorker.postMessage).toHaveBeenCalled();
    });

    it('should handle missing worker gracefully', () => {
      actorSystem.setActor('worker-actor', 'worker-1');
      // Don't set up worker in registry

      mainBus.emit('worker-actor', 'testEvent', 'payload');

      expect(pack).not.toHaveBeenCalled(); // Should not attempt to pack if worker missing
    });

    it('should deliver events to local listeners before posting', () => {
      const mockWorker = { postMessage: vi.fn() };
      const localCallback = vi.fn();

      actorSystem.setActor('worker-actor', 'worker-1');
      workerRegistry.setWorker('worker-1', mockWorker);

      // Register local listener
      mainBus.on('worker-actor', 'testEvent', localCallback);

      mainBus.emit('worker-actor', 'testEvent', 'payload');

      // Both local listener and worker should receive event
      expect(localCallback).toHaveBeenCalledWith('payload');
      expect(mockWorker.postMessage).toHaveBeenCalled();
    });
  });

  describe('handleWorkerMessage()', () => {
    it('should unpack and emit worker messages', () => {
      const callback = vi.fn();
      mainBus.on('worker-actor', 'testEvent', callback);

      const message = {
        actorId: 'worker-actor',
        eventName: 'testEvent',
        payload: { value: 42 },
      };
      const packedData = new TextEncoder().encode(JSON.stringify(message));

      mainBus.handleWorkerMessage(packedData);

      expect(unpack).toHaveBeenCalledWith(new Uint8Array(packedData));
      expect(callback).toHaveBeenCalledWith({ value: 42 });
    });

    it('should handle ArrayBuffer input', () => {
      const callback = vi.fn();
      mainBus.on('worker-actor', 'testEvent', callback);

      const message = { actorId: 'worker-actor', eventName: 'testEvent', payload: 'test' };
      const encoded = new TextEncoder().encode(JSON.stringify(message));
      const arrayBuffer = encoded.buffer;

      mainBus.handleWorkerMessage(arrayBuffer);

      expect(unpack).toHaveBeenCalledWith(new Uint8Array(arrayBuffer));
      expect(callback).toHaveBeenCalledWith('test');
    });

    it('should handle unpacking errors gracefully', () => {
      vi.mocked(unpack).mockImplementationOnce(() => {
        throw new Error('Invalid msgpack data');
      });

      // Should not throw when handling invalid data
      expect(() => {
        mainBus.handleWorkerMessage(new Uint8Array([1, 2, 3]));
      }).not.toThrow();
    });

    it('should route messages from multiple workers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mainBus.on('actor-1', 'event1', callback1);
      mainBus.on('actor-2', 'event2', callback2);

      const message1 = {
        actorId: 'actor-1',
        eventName: 'event1',
        payload: 'payload1',
      };

      const message2 = {
        actorId: 'actor-2',
        eventName: 'event2',
        payload: 'payload2',
      };

      const packedMessage1 = new TextEncoder().encode(JSON.stringify(message1));
      const packedMessage2 = new TextEncoder().encode(JSON.stringify(message2));

      mainBus.handleWorkerMessage(packedMessage1);
      mainBus.handleWorkerMessage(packedMessage2);

      expect(callback1).toHaveBeenCalledWith('payload1');
      expect(callback2).toHaveBeenCalledWith('payload2');
    });
  });

  describe('integration', () => {
    it('should support bidirectional communication', () => {
      const mockWorker = { postMessage: vi.fn() };
      const mainCallback = vi.fn();

      actorSystem.setActor('worker-actor', 'worker-1');
      workerRegistry.setWorker('worker-1', mockWorker);

      // Main -> Worker
      mainBus.on('worker-actor', 'requestEvent', mainCallback);
      mainBus.emit('worker-actor', 'requestEvent', { request: 'data' });

      expect(mockWorker.postMessage).toHaveBeenCalled();

      // Worker -> Main
      const workerResponse = {
        actorId: 'worker-actor',
        eventName: 'responseEvent',
        payload: { response: 'data' },
      };
      const packedResponse = new TextEncoder().encode(JSON.stringify(workerResponse));

      const responseCallback = vi.fn();
      mainBus.on('worker-actor', 'responseEvent', responseCallback);

      mainBus.handleWorkerMessage(packedResponse);

      expect(responseCallback).toHaveBeenCalledWith({ response: 'data' });
    });
  });
});
