import { produceWithPatches, enablePatches, type Draft } from 'immer';
import type { IActorBus } from '../messaging/ActorBus';
import type { EventMap, AllEvents } from '../messaging/types';
import { getActionMetadata } from './decorators';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';

// Enable Immer patches plugin
enablePatches();

type UnknownObject = Record<string, unknown> & { [key: string]: unknown };

export interface ActorMetadata {
  id: string;
  name: string;
  threadId: string;
  dependencies: string[];
}

export abstract class Actor<
  TState extends UnknownObject = {},
  TEvents extends EventMap = {}
> {
  public bus!: IActorBus<AllEvents<TState, TEvents>>;
  private _state: TState;
  private _metadata!: ActorMetadata;

  get metadata(): ActorMetadata {
    return this._metadata;
  }

  // Error context tracking (set by framework)
  private currentContext?: 'action' | 'effect';
  private currentMethod?: string;

  constructor(initialState: TState) {
    this._state = initialState;
  }

  // Framework injection (called after construction)
  __init(bus: IActorBus<AllEvents<TState, TEvents>>, metadata: ActorMetadata): void {
    console.log(`[Actor.__init] Called for actor: ${metadata.id}`);
    this.bus = bus;
    this._metadata = metadata;

    // Subscribe to action method invocations
    // Each @action decorated method becomes an event listener
    const actor = this as unknown as Record<string, unknown>;
    const actionMetadata = getActionMetadata(this.constructor);

    console.log(`[Actor.__init] Found ${actionMetadata.length} actions`);
    for (const { methodName } of actionMetadata) {
      if (typeof actor[methodName] === 'function') {
        console.log(`[Actor.__init] Subscribing to action: ${methodName}`);
        this.bus.on(methodName, (args: unknown[]) => {
          // Invoke the action method with the args array
          (actor[methodName] as (...args: unknown[]) => unknown)(...(args || []));
        });
      }
    }

    // Subscribe to state hydration requests from ActorClients
    console.log('[Actor.__init] Subscribing to __state-request');
    this.bus.on(PROTOCOL_EVENTS.STATE_REQUEST as any, () => {
      console.log('[Actor] Received __state-request, responding with state:', this._state);
      this.bus.emit(PROTOCOL_EVENTS.STATE as any, this._state);
    });
    console.log('[Actor.__init] Completed');
  }

  // Public state access (read-only)
  get state(): TState {
    return this._state;
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
