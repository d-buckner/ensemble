import { MAIN_THREAD_ID } from '../constants';

type MessageHandler = (data: ArrayBuffer | Uint8Array) => void;

export class WorkerRegistry {
  private registry: Record<string, Worker> = {};
  private messageHandler?: MessageHandler;
  private workerOutput: string;

  constructor(workerOutput: string = 'workers') {
    this.workerOutput = workerOutput;
  }

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

    // Construct thread-specific worker bundle path
    const workerPath = `/${this.workerOutput}/${threadId}.js`;
    const worker = new Worker(workerPath);

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