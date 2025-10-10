import Queue from './Queue';


/**
 * Debug context for tracking message origins in development mode
 */
export interface MessageDebugContext {
  actorId: string;
  method: string;
  enqueueStack?: string;
}

/**
 * Mailbox provides per-actor message queuing and sequential processing.
 *
 * In the actor model, each actor has a mailbox (message queue) that buffers
 * incoming messages and processes them one at a time in FIFO order. This ensures:
 * 1. Deterministic state transitions
 * 2. No race conditions from concurrent message processing
 * 3. Backpressure control (can see queue depth)
 *
 * This implementation is synchronous-only. Each message is processed completely
 * before the next one begins. Async support may be added in the future.
 *
 * Uses queueMicrotask to defer processing, ensuring that all synchronously
 * enqueued messages are added to the queue before processing begins.
 */

export class Mailbox {
  private queue = new Queue<() => void>();
  private isProcessing = false;
  private processingScheduled = false;

  /**
   * Enqueue a message handler to be processed sequentially.
   * The handler will be executed in FIFO order after all previously
   * enqueued handlers have completed.
   *
   * Processing is deferred using queueMicrotask, which allows all
   * synchronously enqueued messages to be added before processing begins.
   *
   * @param handler - Synchronous function to execute
   * @param debugContext - Optional debug context for enhanced error reporting (dev mode only)
   */
  enqueue(handler: () => void, debugContext?: MessageDebugContext): void {
    // In development mode, capture stack trace and wrap handler to preserve error context
    if (process.env.NODE_ENV !== 'production' && debugContext) {
      const enqueueStack = new Error().stack;
      const wrappedHandler = () => {
        try {
          handler();
        } catch (error) {
          if (error instanceof Error && error.stack && enqueueStack) {
            // Append enqueue location to error stack for full context
            error.stack += `\n\n--- Enqueued from (${debugContext.actorId}.${debugContext.method}) ---\n${enqueueStack}`;
          }
          throw error;
        }
      };
      this.queue.enqueue(wrappedHandler);
    } else {
      this.queue.enqueue(handler);
    }

    this.scheduleProcessing();
  }

  /**
   * Get the current number of messages waiting in the queue.
   * Useful for monitoring backpressure and debugging.
   */
  get length(): number {
    return this.queue.size;
  }

  /**
   * Check if the mailbox is currently processing a message.
   */
  get isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Schedule processing to begin on the next microtask.
   * This ensures all synchronous enqueues complete before processing starts.
   */
  private scheduleProcessing(): void {
    if (this.processingScheduled || this.isProcessing) {
      return;
    }

    this.processingScheduled = true;
    queueMicrotask(() => {
      this.processingScheduled = false;
      this.processNext();
    });
  }

  /**
   * Process the next message in the queue.
   * This is called automatically after queueMicrotask and recursively
   * processes all queued messages.
   */
  private processNext(): void {
    // Don't start processing if already processing or queue is empty
    if (this.isProcessing || this.queue.isEmpty) {
      return;
    }

    this.isProcessing = true;
    const handler = this.queue.dequeue()!;

    try {
      handler();
    } catch (error) {
      // Isolate errors - one failed message doesn't break the mailbox
      // In production, this would typically be logged or sent to error monitoring
      console.error('[Mailbox] Handler error:', error);
    } finally {
      this.isProcessing = false;

      // Process next message if any are queued
      // Using synchronous recursion since handlers are synchronous
      if (!this.queue.isEmpty) {
        this.processNext();
      }
    }
  }
}
