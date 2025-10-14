import { WORKER_PATHS } from  'virtual:worker-manifest';
import { MAIN_THREAD_ID } from '../constants';


type MessageHandler = (data: ArrayBuffer | Uint8Array) => void;

export class WorkerRegistry {
  private registry = new Map<string, Worker>();
  private messageHandler?: MessageHandler;

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

  add(threadId: string): void {
    if (threadId === MAIN_THREAD_ID) {
      throw new Error(`Cannot register a worker with reserved threadId: ${MAIN_THREAD_ID}`);
    }

    if (this.registry.has(threadId)) {
      throw new Error(`Cannot register worker as worker with threadId that already exists: ${threadId}`);
    }

    // Get worker path from manifest (with content hash in production)
    const workerPath = WORKER_PATHS[threadId];
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
