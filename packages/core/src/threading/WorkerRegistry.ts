import { MAIN_THREAD_ID } from '../constants';

type MessageHandler = (data: ArrayBuffer | Uint8Array) => void;

export class WorkerRegistry {
  static readonly WORKER_PATH = '/js/worker.js';
  private registry: Record<string, Worker> = {};
  private messageHandler?: MessageHandler;

  /**
   * Set the message handler that will be called when workers send messages
   * Typically this would be MainBus.handleWorkerMessage
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;

    // Attach handler to all existing workers
    for (const worker of Object.values(this.registry)) {
      worker.addEventListener('message', (event) => {
        this.messageHandler?.(event.data);
      });
    }
  }

  add(threadId: string): void {
    if (threadId === MAIN_THREAD_ID) {
      throw new Error(`Cannot register a worker with reserved threadId: ${MAIN_THREAD_ID}`);
    }

    if (this.registry[threadId]) {
      throw new Error(`Cannot register worker as worker with threadId that already exists: ${threadId}`);
    }

    const worker = new Worker(WorkerRegistry.WORKER_PATH);

    // Attach message handler if already set
    if (this.messageHandler) {
      worker.addEventListener('message', (event) => {
        this.messageHandler?.(event.data);
      });
    }

    this.registry[threadId] = worker;
  }

  get(threadId: string): Worker | null {
    return this.registry[threadId] ?? null;
  }

  has(threadId: string): boolean {
    return Boolean(this.registry[threadId]);
  }
}