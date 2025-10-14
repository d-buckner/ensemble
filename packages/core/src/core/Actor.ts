import { create, type Draft } from 'mutative';
import EventEmitter from '../messaging/EventEmitter';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';
import { getActionMetadata } from './decorators';
import { Mailbox } from './Mailbox';
import type { IActorBus } from '../messaging/ActorBus';
import type { AllEvents, TypedListener } from '../messaging/types';
import type { DeepReadonly } from '../utils/types';

export interface ActorMetadata {
  id: string;
  name: string;
  threadId: string;
  dependencies: string[];
}

/**
 * Extract state type from Actor class
 */
export type StateOf<T> = T extends Actor<infer S, any> ? S : never;

/**
 * Extract events type from Actor class
 */
export type EventsOf<T> = T extends Actor<any, infer E> ? E : never;

/**
 * StateShape enforces that all state keys (including optional ones) are present.
 * This ensures event listeners are created for all state properties.
 *
 * Example:
 *   interface MyState { count: number; name?: string }
 *   StateShape<MyState> = { count: number; name: string | undefined }
 */
export type StateShape<T> = {
  [K in keyof T]-?: T[K] | undefined;
};

/**
 * Type for Actor class constructors.
 * Used to properly type actor registries and ensure initialState is present.
 */
export interface ActorConstructor<T extends Actor = Actor> {
  new(...args: any[]): T;
  readonly initialState: StateShape<StateOf<T>>;
}

export abstract class Actor<
  TState = any,
  TEvents = any
> {
  // Bus is only used for worker-thread actors (cross-thread communication)
  public bus?: IActorBus<AllEvents<TState, TEvents>>;

  // Internal EventEmitter for same-thread communication (main-thread actors)
  private internalEventEmitter = new EventEmitter<AllEvents<TState, TEvents>>();

  private _state: TState;
  private _metadata!: ActorMetadata;
  public readonly mailbox = new Mailbox();
  private stateUpdateQueue: Array<(draft: Draft<TState>) => void> = [];

  // Dependency injection - set by ActorSystem
  protected declare deps?: Record<string, any>;

  get metadata(): ActorMetadata {
    return this._metadata;
  }

  get state(): TState {
    return this._state;
  }

  // Error context tracking (set by framework)
  private currentContext?: 'action' | 'effect';
  private currentMethod?: string;

  /**
   * Constructor requires StateShape to enforce all state keys are present.
   * Concrete actors should define `static readonly initialState` and pass it to super().
   * TypeScript will enforce all keys (including optional ones) are explicitly provided.
   */
  constructor(initialState: StateShape<TState>) {
    // Deep copy initialState to ensure each instance has its own state object
    // This prevents state from being shared across multiple actor instances
    this._state = structuredClone(initialState) as TState;
    this.updateStateBatch = this.updateStateBatch.bind(this);
  }

  // Framework injection (called after construction)
  // Bus is optional - only provided for worker-thread actors
  __init(metadata: ActorMetadata, bus?: IActorBus<AllEvents<TState, TEvents>>): void {
    this._metadata = metadata;
    this.bus = bus;

    // Only setup bus listeners if bus is provided (worker-thread actors)
    if (!this.bus) {
      return;
    }

    // Subscribe to action method invocations
    // Each @action decorated method becomes an event listener
    const actionMetadata = getActionMetadata(this.constructor);

    for (const metadataEntry of actionMetadata) {
      const methodName = metadataEntry.methodName as keyof this;

      if (typeof this[methodName] === 'function') {
        // Action methods must be declared in TEvents interface with their parameter tuple types
        // At runtime, action invocations always pass argument arrays, but TypeScript can't
        // verify this statically since TEvents may mix arrays and objects
        this.bus.on(methodName as Exclude<keyof TEvents, symbol>, ((args: unknown[]) => {
          // Enqueue action invocation to mailbox for sequential processing
          this.mailbox.enqueue(
            () => (this[methodName] as (...args: unknown[]) => void)(...args),
            {
              actorId: this._metadata.id,
              method: methodName as string,
            }
          );
        }) as any);
      }
    }

    // Subscribe to state hydration requests from ActorClients
    // State requests are queued to ensure consistency with in-progress state mutations
    this.bus.on(PROTOCOL_EVENTS.STATE_REQUEST as any, () => {
      this.mailbox.enqueue(
        () => {
          this.bus!.emit(PROTOCOL_EVENTS.STATE as any, this._state);
        },
        {
          actorId: this._metadata.id,
          method: '__state_request',
        }
      );
    });
  }

  // ============================================================================
  // Internal hooks for SyncActorClient (main-thread actors)
  // ============================================================================

  /**
   * Subscribe to state updates via internal EventEmitter (for main-thread actors)
   * Returns unsubscribe function
   * @internal Used by SyncActorClient
   */
  __onStateUpdate(callback: TypedListener<Partial<TState>>): () => void {
    this.internalEventEmitter.on(PROTOCOL_EVENTS.STATE_PARTIAL as unknown as keyof AllEvents<TState, TEvents>, callback as any);
    return () => {
      this.internalEventEmitter.off(PROTOCOL_EVENTS.STATE_PARTIAL as unknown as keyof AllEvents<TState, TEvents>, callback as any);
    };
  }

  /**
   * Register a listener for custom events via internal EventEmitter (for main-thread actors)
   * Returns unsubscribe function
   * @internal Used by SyncActorClient
   */
  __registerInternalListener<K extends keyof TEvents>(
    eventName: K,
    callback: TypedListener<TEvents[K]>
  ): () => void {
    this.internalEventEmitter.on(eventName as unknown as keyof AllEvents<TState, TEvents>, callback as any);
    return () => {
      this.internalEventEmitter.off(eventName as unknown as keyof AllEvents<TState, TEvents>, callback as any);
    };
  }

  /**
   * Invoke an action method on this actor
   * @internal Used by SyncActorClient and effects
   *
   * Main-thread actors (no bus): Direct synchronous invocation
   * Worker-thread actors (with bus): Mailbox for async FIFO processing
   */
  __invokeAction(methodName: string, args: unknown[]): void {
    const method = (this as any)[methodName];
    if (typeof method !== 'function') {
      return;
    }

    // Main-thread actors: Direct synchronous invocation
    // No async message arrival, no mailbox overhead needed
    if (!this.bus) {
      method.apply(this, args);
      return;
    }

    // Worker-thread actors: Use mailbox for async message handling
    // Messages arrive via postMessage and need FIFO ordering & error isolation
    this.mailbox.enqueue(
      () => method.apply(this, args),
      {
        actorId: this._metadata.id,
        method: methodName,
      }
    );
  }

  // State transition with Immer draft syntax
  protected setState(updater: (draft: Draft<TState>) => void): void {
    this.stateUpdateQueue.push(updater);

    if (this.stateUpdateQueue.length === 1) {
      queueMicrotask(this.updateStateBatch);
    }
  }

  private updateStateBatch() {
    const batchUpdater = (draft: Draft<TState>) => {
      this.stateUpdateQueue.forEach(updater => {
        updater(draft);
      });

      this.stateUpdateQueue = [];
    };

    const [nextState, patches] = create(this._state, batchUpdater, { enablePatches: true });

    if (nextState === this._state) {
      return; // No changes (Mutative returns same reference if no mutations)
    }

    this._state = nextState;

    // Build batched partial state update
    const partial: Partial<TState> = {};
    patches.forEach(patch => {
      // patch.path is like ['items', 0, 'name'] or ['filter']
      // We only emit events for top-level properties
      if (patch.path.length > 0) {
        const key = patch.path[0] as keyof TState;
        partial[key] = this._state[key];
      }
    });

    // Dual emission: emit to both internal EventEmitter and bus (if present)
    this.internalEventEmitter.emit(PROTOCOL_EVENTS.STATE_PARTIAL as unknown as keyof AllEvents<TState, TEvents>, partial as any);
    if (this.bus) {
      this.bus.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);
    }
  }

  // Event emission
  protected emit<K extends keyof TEvents>(
    eventName: K,
    payload: DeepReadonly<TEvents[K]>
  ): void {
    // Freeze payload in development to catch mutation bugs
    if (process.env.NODE_ENV !== 'production') {
      Object.freeze(payload);
    }

    // Dual emission: emit to both internal EventEmitter and bus (if present)
    this.internalEventEmitter.emit(eventName as unknown as keyof AllEvents<TState, TEvents>, payload as any);
    if (this.bus) {
      // Event names are strings/numbers (no symbols in serializable events)
      this.bus.emit(eventName as string | number, payload);
    }
  }

  // Error emission
  protected throw(message: string, details?: unknown): void {
    const errorPayload = {
      source: this.currentContext || 'action',
      method: this.currentMethod || 'unknown',
      error: new Error(message),
      details,
      timestamp: Date.now(),
    };

    // Dual emission: emit to both internal EventEmitter and bus (if present)
    this.internalEventEmitter.emit('error' as unknown as keyof AllEvents<TState, TEvents>, errorPayload as any);
    if (this.bus) {
      this.bus.emit('error', errorPayload);
    }
  }

  // Context management (used by framework)
  __setContext(context: 'action' | 'effect', method: string): void {
    this.currentContext = context;
    this.currentMethod = method;
  }

  __clearContext(): void {
    this.currentContext = undefined;
    this.currentMethod = undefined;
  }

  // Lifecycle hooks (optional overrides)
  public onInit?(): void | Promise<void>;
  public onDestroy?(): void | Promise<void>;
}
