import { MAIN_THREAD_ID } from '../constants';


type MessageHandler = (data: ArrayBuffer | Uint8Array) => void;

export class WorkerRegistry {
  private registry = new Map<string, Worker>();
  private messageHandler?: MessageHandler;
  private workerPaths?: Record<string, string>;

  /**
   * Lazy-load worker paths from virtual module.
   * Only loads when actually needed (when first worker is registered).
   * This allows main-thread only apps to avoid requiring the vite plugin.
   */
  private async loadWorkerPaths(): Promise<Record<string, string>> {
    if (!this.workerPaths) {
      try {
        const { WORKER_PATHS } = await import('virtual:worker-manifest');
        this.workerPaths = WORKER_PATHS;
      } catch {
        throw new Error(
          'Failed to load worker manifest. If you are using @thread decorators, ' +
          'you must configure @d-buckner/ensemble-vite-plugin in your vite.config.ts. ' +
          'For main-thread only applications, avoid using @thread decorators. ' +
          'See https://github.com/d-buckner/ensemble for setup instructions.'
        );
      }
    }
    return this.workerPaths;
  }

  /**
   * Set the message handler that will be called when workers send messages
   * Typically this would be MainBus.handleWorkerMessage
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;

    // Attach handler to all existing workers
    for (const worker of this.registry.values()) {
      worker.addEventListener('message', (event) => {
        this.messageHandler?.(event.data);
      });
    }
  }

  async add(threadId: string): Promise<void> {
    if (threadId === MAIN_THREAD_ID) {
      throw new Error(`Cannot register a worker with reserved threadId: ${MAIN_THREAD_ID}`);
    }

    if (this.registry.has(threadId)) {
      throw new Error(`Cannot register worker as worker with threadId that already exists: ${threadId}`);
    }

    // Get worker path from manifest (with content hash in production)
    const paths = await this.loadWorkerPaths();
    const workerPath = paths[threadId];
    if (!workerPath) {
      throw new Error(`Worker path not found in manifest for threadId: ${threadId}`);
    }

    const worker = new Worker(workerPath);

    // Attach message handler if already set
    if (this.messageHandler) {
      worker.addEventListener('message', (event) => {
        this.messageHandler?.(event.data);
      });
    }

    this.registry.set(threadId, worker);
  }

  get(threadId: string): Worker | null {
    return this.registry.get(threadId) ?? null;
  }

  has(threadId: string): boolean {
    return this.registry.has(threadId);
  }

  terminateAll(): void {
    for (const worker of this.registry.values()) {
      worker.terminate();
    }
    this.registry.clear();
  }
}
