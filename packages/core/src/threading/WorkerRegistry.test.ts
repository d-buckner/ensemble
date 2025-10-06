import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerRegistry } from './WorkerRegistry';
import { MAIN_THREAD_ID } from '../constants';

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

  // Simulate receiving a message from the worker
  simulateMessage(data: unknown): void {
    const event = { data } as MessageEvent;
    this.listeners.get('message')?.forEach(cb => cb(event));
  }

  terminate(): void {
    this.listeners.clear();
  }
}

describe('WorkerRegistry', () => {
  let registry: WorkerRegistry;
  let originalWorker: typeof Worker;

  beforeEach(() => {
    registry = new WorkerRegistry();

    // Mock global Worker
    originalWorker = globalThis.Worker;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    // Restore original Worker
    globalThis.Worker = originalWorker;
  });

  describe('add()', () => {
    it('should create and register a new worker', () => {
      registry.add('worker-1');

      const worker = registry.get('worker-1');
      expect(worker).toBeDefined();
      expect((worker as unknown as MockWorker).url).toBe(WorkerRegistry.WORKER_PATH);
    });

    it('should throw when trying to register main thread', () => {
      expect(() => {
        registry.add(MAIN_THREAD_ID);
      }).toThrow(`Cannot register a worker with reserved threadId: ${MAIN_THREAD_ID}`);
    });

    it('should throw when trying to register duplicate threadId', () => {
      registry.add('worker-1');

      expect(() => {
        registry.add('worker-1');
      }).toThrow('Cannot register worker as worker with threadId that already exists: worker-1');
    });

    it('should attach message handler to new worker if handler already set', () => {
      const handler = vi.fn();
      registry.setMessageHandler(handler);

      registry.add('worker-1');

      const worker = registry.get('worker-1') as unknown as MockWorker;
      const testData = { test: 'data' };
      worker.simulateMessage(testData);

      expect(handler).toHaveBeenCalledWith(testData);
    });

    it('should register multiple workers', () => {
      registry.add('worker-1');
      registry.add('worker-2');
      registry.add('worker-3');

      expect(registry.has('worker-1')).toBe(true);
      expect(registry.has('worker-2')).toBe(true);
      expect(registry.has('worker-3')).toBe(true);
    });
  });

  describe('get()', () => {
    it('should return worker if exists', () => {
      registry.add('worker-1');

      const worker = registry.get('worker-1');

      expect(worker).toBeDefined();
      expect(worker).toBeInstanceOf(MockWorker);
    });

    it('should return null if worker does not exist', () => {
      const worker = registry.get('nonexistent');

      expect(worker).toBeNull();
    });
  });

  describe('has()', () => {
    it('should return true if worker exists', () => {
      registry.add('worker-1');

      expect(registry.has('worker-1')).toBe(true);
    });

    it('should return false if worker does not exist', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('setMessageHandler()', () => {
    it('should set message handler', () => {
      const handler = vi.fn();

      registry.setMessageHandler(handler);
      registry.add('worker-1');

      const worker = registry.get('worker-1') as unknown as MockWorker;
      worker.simulateMessage({ test: 'data' });

      expect(handler).toHaveBeenCalledWith({ test: 'data' });
    });

    it('should attach handler to all existing workers', () => {
      registry.add('worker-1');
      registry.add('worker-2');

      const handler = vi.fn();
      registry.setMessageHandler(handler);

      const worker1 = registry.get('worker-1') as unknown as MockWorker;
      const worker2 = registry.get('worker-2') as unknown as MockWorker;

      worker1.simulateMessage({ from: 'worker-1' });
      worker2.simulateMessage({ from: 'worker-2' });

      expect(handler).toHaveBeenCalledWith({ from: 'worker-1' });
      expect(handler).toHaveBeenCalledWith({ from: 'worker-2' });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should attach handler to workers added after handler is set', () => {
      const handler = vi.fn();
      registry.setMessageHandler(handler);

      registry.add('worker-1');
      const worker = registry.get('worker-1') as unknown as MockWorker;
      worker.simulateMessage({ test: 'data' });

      expect(handler).toHaveBeenCalledWith({ test: 'data' });
    });

  });

  describe('integration', () => {
    it('should coordinate multiple workers with handler', () => {
      const messages: Array<{ threadId: string; data: unknown }> = [];
      const handler = vi.fn((data) => {
        // Track which worker sent what
        messages.push({ threadId: 'unknown', data });
      });

      registry.setMessageHandler(handler);

      registry.add('worker-1');
      registry.add('worker-2');

      const worker1 = registry.get('worker-1') as unknown as MockWorker;
      const worker2 = registry.get('worker-2') as unknown as MockWorker;

      worker1.simulateMessage({ from: 'worker-1', value: 1 });
      worker2.simulateMessage({ from: 'worker-2', value: 2 });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(messages).toHaveLength(2);
    });
  });
});
