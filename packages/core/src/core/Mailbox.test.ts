import { describe, it, expect, vi } from 'vitest';
import { Mailbox } from './Mailbox';


describe('Mailbox', () => {

  describe('FIFO ordering', () => {
    it('should process messages in FIFO order', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];

      mailbox.enqueue(() => results.push(1));
      mailbox.enqueue(() => results.push(2));
      mailbox.enqueue(() => results.push(3));

      await flushAsync();
      expect(results).toEqual([1, 2, 3]);
    });

    it('should maintain order across multiple batches', async () => {
      const mailbox = new Mailbox();
      const results: string[] = [];

      mailbox.enqueue(() => results.push('a'));
      mailbox.enqueue(() => results.push('b'));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(results).toEqual(['a', 'b']);

      mailbox.enqueue(() => results.push('c'));
      mailbox.enqueue(() => results.push('d'));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(results).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('sequential processing', () => {
    it('should process one message at a time', async () => {
      const mailbox = new Mailbox();
      const executionLog: string[] = [];

      mailbox.enqueue(() => {
        executionLog.push('start-1');
        expect(mailbox.isActive).toBe(true);
        executionLog.push('end-1');
      });

      mailbox.enqueue(() => {
        executionLog.push('start-2');
        expect(mailbox.isActive).toBe(true);
        executionLog.push('end-2');
      });

      await new Promise(resolve => setTimeout(resolve, 0));
      // Both should have completed sequentially
      expect(executionLog).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });

    it('should set isActive to false after processing all messages', async () => {
      const mailbox = new Mailbox();

      mailbox.enqueue(() => {
        expect(mailbox.isActive).toBe(true);
      });

      // Before processing starts
      expect(mailbox.isActive).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 0));
      // After processing completes
      expect(mailbox.isActive).toBe(false);
    });

    it('should handle nested enqueues correctly', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];

      mailbox.enqueue(() => {
        results.push(1);
        // Enqueue from within a handler
        mailbox.enqueue(() => results.push(3));
      });

      mailbox.enqueue(() => results.push(2));

      // Wait for microtask queue to flush
      await new Promise(resolve => setTimeout(resolve, 0));

      // Order should be 1, 2, 3 because:
      // 1. Both handlers are enqueued synchronously before processing starts
      // 2. Processing begins via queueMicrotask
      // 3. First handler executes, pushes 1, enqueues handler for 3
      // 4. Second handler executes, pushes 2
      // 5. Third handler executes (from nested enqueue), pushes 3
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe('error handling', () => {
    it('should isolate errors and continue processing', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mailbox.enqueue(() => results.push(1));
      mailbox.enqueue(() => {
        throw new Error('Test error');
      });
      mailbox.enqueue(() => results.push(3));

      await new Promise(resolve => setTimeout(resolve, 0));
      // Should have processed all three, skipping the error
      expect(results).toEqual([1, 3]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Mailbox] Handler error:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should continue processing after multiple errors', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mailbox.enqueue(() => {
        throw new Error('Error 1');
      });
      mailbox.enqueue(() => results.push(1));
      mailbox.enqueue(() => {
        throw new Error('Error 2');
      });
      mailbox.enqueue(() => results.push(2));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(results).toEqual([1, 2]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('should set isActive to false even after error', async () => {
      const mailbox = new Mailbox();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mailbox.enqueue(() => {
        throw new Error('Test error');
      });

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mailbox.isActive).toBe(false);
      expect(mailbox.length).toBe(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('queue length tracking', () => {
    it('should track queue length accurately', async () => {
      const mailbox = new Mailbox();

      expect(mailbox.length).toBe(0);

      mailbox.enqueue(() => {});
      // Before processing starts, queue has 1 message
      expect(mailbox.length).toBe(1);

      await new Promise(resolve => setTimeout(resolve, 0));
      // After processing, queue should be empty
      expect(mailbox.length).toBe(0);
    });

    it('should show queue length when messages are pending', async () => {
      const mailbox = new Mailbox();
      let lengthDuringProcessing = -1;

      mailbox.enqueue(() => {
        // Enqueue more while processing
        mailbox.enqueue(() => {});
        mailbox.enqueue(() => {});
        lengthDuringProcessing = mailbox.length;
      });

      await new Promise(resolve => setTimeout(resolve, 0));
      // Should have seen 2 messages in queue during processing
      expect(lengthDuringProcessing).toBe(2);
      // All should be processed by now
      expect(mailbox.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty queue gracefully', async () => {
      const mailbox = new Mailbox();

      expect(mailbox.length).toBe(0);
      expect(mailbox.isActive).toBe(false);
    });

    it('should handle single message', async () => {
      const mailbox = new Mailbox();
      const result: number[] = [];

      mailbox.enqueue(() => result.push(42));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(result).toEqual([42]);
      expect(mailbox.length).toBe(0);
      expect(mailbox.isActive).toBe(false);
    });

    it('should handle rapid consecutive enqueues', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];

      for (let i = 0; i < 100; i++) {
        mailbox.enqueue(() => results.push(i));
      }

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(results.length).toBe(100);
      expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    it('should handle handlers that enqueue themselves', async () => {
      const mailbox = new Mailbox();
      const results: number[] = [];
      let count = 0;

      const recursiveHandler = () => {
        results.push(count);
        count++;
        if (count < 5) {
          mailbox.enqueue(recursiveHandler);
        }
      };

      mailbox.enqueue(recursiveHandler);

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(results).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
