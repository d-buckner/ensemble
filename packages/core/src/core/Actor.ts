import { produceWithPatches, enablePatches, type Draft } from 'immer';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';
import { getActionMetadata } from './decorators';
import type { IActorBus } from '../messaging/ActorBus';
import type { AllEvents } from '../messaging/types';

// Enable Immer patches plugin
enablePatches();

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
  new (...args: any[]): T;
  readonly initialState: StateShape<StateOf<T>>;
}

export abstract class Actor<
  TState = {},
  TEvents = {}
> {
  public bus!: IActorBus<AllEvents<TState, TEvents>>;
  private _state: TState;
  private _metadata!: ActorMetadata;

  // Dependency injection - set by ActorSystem
  protected declare deps?: Record<string, any>;

  get metadata(): ActorMetadata {
    return this._metadata;
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
  }

  // Framework injection (called after construction)
  __init(bus: IActorBus<AllEvents<TState, TEvents>>, metadata: ActorMetadata): void {
    this.bus = bus;
    this._metadata = metadata;

    // Subscribe to action method invocations
    // Each @action decorated method becomes an event listener
    const actor = this as unknown as Record<string, unknown>;
    const actionMetadata = getActionMetadata(this.constructor);

    for (const { methodName } of actionMetadata) {
      if (typeof actor[methodName] === 'function') {
        // Action methods must be declared in TEvents interface with their parameter tuple types
        // At runtime, action invocations always pass argument arrays, but TypeScript can't
        // verify this statically since TEvents may mix arrays and objects
        this.bus.on(methodName as keyof TEvents, ((args: unknown[]) => {
          // Invoke the action method with the args array
          (actor[methodName] as (...args: unknown[]) => unknown)(...(args || []));
        }) as any);
      }
    }

    // Subscribe to state hydration requests from ActorClients
    this.bus.on(PROTOCOL_EVENTS.STATE_REQUEST as any, () => {
      this.bus.emit(PROTOCOL_EVENTS.STATE as any, this._state);
    });
  }

  // State transition with Immer draft syntax
  protected setState(updater: (draft: Draft<TState>) => void): void {
    const [nextState, patches] = produceWithPatches(this._state, updater);

    if (nextState === this._state) {
      return; // No changes (Immer returns same reference if no mutations)
    }

    this._state = nextState;

    // Extract top-level properties from patches
    const changedProps = new Set<keyof TState>();
    patches.forEach(patch => {
      // patch.path is like ['items', 0, 'name'] or ['filter']
      // We only emit events for top-level properties
      if (patch.path.length > 0) {
        changedProps.add(patch.path[0] as keyof TState);
      }
    });

    // Emit events ONLY for changed top-level properties
    changedProps.forEach(prop => {
      // Type-safe: prop is keyof TState, which is a subset of AllEvents keys
      this.emitStateChange(prop, this._state[prop]);
    });
  }

  // Internal helper for state change events
  private emitStateChange<K extends keyof TState>(
    eventName: K,
    payload: TState[K]
  ): void {
    // State keys are strings/numbers (no symbols in serializable state)
    this.bus.emit(eventName as string | number, payload);
  }

  // Event emission
  protected emit<K extends keyof TEvents>(
    eventName: K,
    payload: TEvents[K]
  ): void {
    // Event names are strings/numbers (no symbols in serializable events)
    this.bus.emit(eventName as string | number, payload);
  }

  // Error emission
  protected throw(message: string, details?: unknown): void {
    this.bus.emit('error', {
      source: this.currentContext || 'action',
      method: this.currentMethod || 'unknown',
      error: new Error(message),
      details,
      timestamp: Date.now(),
    });
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
