import { describe, it, expect } from 'vitest';
import Queue from './Queue';

describe('Queue', () => {
  describe('enqueue and dequeue', () => {
    it('should enqueue and dequeue in FIFO order', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(queue.dequeue()).toBe(1);
      expect(queue.dequeue()).toBe(2);
      expect(queue.dequeue()).toBe(3);
    });

    it('should handle single item', () => {
      const queue = new Queue<string>();

      queue.enqueue('test');
      expect(queue.dequeue()).toBe('test');
    });

    it('should handle alternating enqueue and dequeue', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      expect(queue.dequeue()).toBe(1);

      queue.enqueue(2);
      expect(queue.dequeue()).toBe(2);

      queue.enqueue(3);
      expect(queue.dequeue()).toBe(3);
    });

    it('should return undefined when dequeuing from empty queue', () => {
      const queue = new Queue<number>();

      expect(queue.dequeue()).toBeUndefined();
    });

    it('should handle complex data types', () => {
      interface Data {
        id: string;
        value: number;
      }

      const queue = new Queue<Data>();
      const item1 = { id: 'a', value: 1 };
      const item2 = { id: 'b', value: 2 };

      queue.enqueue(item1);
      queue.enqueue(item2);

      expect(queue.dequeue()).toBe(item1);
      expect(queue.dequeue()).toBe(item2);
    });
  });

  describe('size tracking', () => {
    it('should start with size 0', () => {
      const queue = new Queue<number>();
      expect(queue.size).toBe(0);
    });

    it('should increment size on enqueue', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      expect(queue.size).toBe(1);

      queue.enqueue(2);
      expect(queue.size).toBe(2);

      queue.enqueue(3);
      expect(queue.size).toBe(3);
    });

    it('should decrement size on dequeue', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(queue.size).toBe(3);

      queue.dequeue();
      expect(queue.size).toBe(2);

      queue.dequeue();
      expect(queue.size).toBe(1);

      queue.dequeue();
      expect(queue.size).toBe(0);
    });

    it('should not go below 0 when dequeuing from empty queue', () => {
      const queue = new Queue<number>();

      expect(queue.size).toBe(0);
      queue.dequeue();
      expect(queue.size).toBe(0);
      queue.dequeue();
      expect(queue.size).toBe(0);
    });

    it('should track size accurately with mixed operations', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      expect(queue.size).toBe(2);

      queue.dequeue();
      expect(queue.size).toBe(1);

      queue.enqueue(3);
      queue.enqueue(4);
      expect(queue.size).toBe(3);

      queue.dequeue();
      queue.dequeue();
      expect(queue.size).toBe(1);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty queue', () => {
      const queue = new Queue<number>();
      expect(queue.isEmpty).toBe(true);
    });

    it('should return false for non-empty queue', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      expect(queue.isEmpty).toBe(false);
    });

    it('should return true after all items are dequeued', () => {
      const queue = new Queue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      expect(queue.isEmpty).toBe(false);

      queue.dequeue();
      expect(queue.isEmpty).toBe(false);

      queue.dequeue();
      expect(queue.isEmpty).toBe(true);
    });

    it('should handle multiple cycles of empty and non-empty', () => {
      const queue = new Queue<number>();

      expect(queue.isEmpty).toBe(true);

      queue.enqueue(1);
      expect(queue.isEmpty).toBe(false);

      queue.dequeue();
      expect(queue.isEmpty).toBe(true);

      queue.enqueue(2);
      queue.enqueue(3);
      expect(queue.isEmpty).toBe(false);

      queue.dequeue();
      queue.dequeue();
      expect(queue.isEmpty).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle many items', () => {
      const queue = new Queue<number>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        queue.enqueue(i);
      }

      expect(queue.size).toBe(count);

      for (let i = 0; i < count; i++) {
        expect(queue.dequeue()).toBe(i);
      }

      expect(queue.size).toBe(0);
      expect(queue.isEmpty).toBe(true);
    });

    it('should maintain FIFO order with many operations', () => {
      const queue = new Queue<number>();

      // Enqueue 10 items
      for (let i = 0; i < 10; i++) {
        queue.enqueue(i);
      }

      // Dequeue 5 items
      for (let i = 0; i < 5; i++) {
        expect(queue.dequeue()).toBe(i);
      }

      // Enqueue 5 more items
      for (let i = 10; i < 15; i++) {
        queue.enqueue(i);
      }

      // Dequeue remaining items
      expect(queue.dequeue()).toBe(5);
      expect(queue.dequeue()).toBe(6);
      expect(queue.dequeue()).toBe(7);
      expect(queue.dequeue()).toBe(8);
      expect(queue.dequeue()).toBe(9);
      expect(queue.dequeue()).toBe(10);
      expect(queue.dequeue()).toBe(11);
      expect(queue.dequeue()).toBe(12);
      expect(queue.dequeue()).toBe(13);
      expect(queue.dequeue()).toBe(14);

      expect(queue.isEmpty).toBe(true);
    });

    it('should handle null and undefined values', () => {
      const queue = new Queue<number | null | undefined>();

      queue.enqueue(1);
      queue.enqueue(null);
      queue.enqueue(undefined);
      queue.enqueue(2);

      expect(queue.dequeue()).toBe(1);
      expect(queue.dequeue()).toBe(null);
      expect(queue.dequeue()).toBe(undefined);
      expect(queue.dequeue()).toBe(2);
    });
  });
});
