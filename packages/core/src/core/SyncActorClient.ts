import { getEffectMetadata } from './decorators';
import type { Actor, StateOf, ActorConstructor } from './Actor';
import type { IActorClient, ActionsOf, ClientAllEvents } from './types';
import type { TypedListener } from '../messaging/types';

/**
 * SyncActorClient provides synchronous access to actors running on the main thread.
 *
 * This client has direct access to the actor instance and communicates via internal
 * EventEmitter rather than message passing. All operations are synchronous.
 *
 * Key characteristics:
 * - State is a direct reference to actor's internal state (via __getState())
 * - Actions invoke methods directly on the actor instance
 * - Custom events are subscribed via internal EventEmitter
 * - No state hydration needed - state is always current
 * - Effects are setup and managed internally by this client
 */
export class SyncActorClient<TActor extends Actor<any, any>> implements IActorClient<TActor> {
  private actorInstance: TActor;
  private deps: Record<string, IActorClient<any>>;
  private unsubscribers: Array<() => void> = [];
  private stateListeners = new Map<keyof StateOf<TActor>, Set<TypedListener<any>>>();
  private customEventListeners = new Map<keyof ClientAllEvents<TActor>, Set<TypedListener<any>>>();
  // Track callback-to-unsubscriber mappings for proper cleanup
  private customEventUnsubscribers = new Map<
    keyof ClientAllEvents<TActor>,
    Map<TypedListener<any>, () => void>
  >();
  public readonly actions: ActionsOf<TActor>;

  constructor(
    actorInstance: TActor,
    deps: Record<string, IActorClient<any>>,
    ActorClass: ActorConstructor<TActor>
  ) {
    this.actorInstance = actorInstance;
    this.deps = deps;

    // Subscribe to state updates via internal EventEmitter
    const stateUnsub = this.actorInstance.__onStateUpdate((partial) => {
      this.handleStateUpdate(partial);
    });
    this.unsubscribers.push(stateUnsub);

    // Setup effects (handled internally, not in ActorSystem)
    this.setupEffects(ActorClass);

    // Create action proxy for direct method invocation
    this.actions = this.createActionProxy();
  }

  get state(): StateOf<TActor> {
    // Direct access to actor's state - no caching, always current
    return this.actorInstance.state;
  }

  on<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    // Check if this is a state property subscription
    if (eventName in this.state) {
      // Store state listener
      if (!this.stateListeners.has(eventName as keyof StateOf<TActor>)) {
        this.stateListeners.set(eventName as keyof StateOf<TActor>, new Set());
      }
      this.stateListeners.get(eventName as keyof StateOf<TActor>)!.add(callback);
      return;
    }

    // Custom event subscription - register with actor's internal EventEmitter
    if (!this.customEventListeners.has(eventName)) {
      this.customEventListeners.set(eventName, new Set());
    }
    this.customEventListeners.get(eventName)!.add(callback);

    const unsub = this.actorInstance.__registerInternalListener(
      eventName as keyof ClientAllEvents<TActor>,
      callback
    );

    // Track the callback-to-unsubscriber mapping for this event
    if (!this.customEventUnsubscribers.has(eventName)) {
      this.customEventUnsubscribers.set(eventName, new Map());
    }
    this.customEventUnsubscribers.get(eventName)!.set(callback, unsub);

    this.unsubscribers.push(unsub);
  }

  off<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    // State property listener
    if (eventName in this.state) {
      const listeners = this.stateListeners.get(eventName as keyof StateOf<TActor>);
      if (listeners) {
        listeners.delete(callback);
      }
      return;
    }

    // Custom event listener - unsubscribe from actor's internal EventEmitter
    const listeners = this.customEventListeners.get(eventName);
    if (listeners) {
      listeners.delete(callback);
    }

    // Find and call the tracked unsubscriber for this callback
    const eventUnsubscribers = this.customEventUnsubscribers.get(eventName);
    if (eventUnsubscribers) {
      const unsub = eventUnsubscribers.get(callback);
      if (unsub) {
        unsub(); // Call the unsubscriber to remove from actor's EventEmitter
        eventUnsubscribers.delete(callback); // Remove from tracking map
      }
    }
  }

  dispose(): void {
    // Call all unsubscribers to clean up event listeners
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];

    // Clear listener maps
    this.stateListeners.clear();
    this.customEventListeners.clear();
    this.customEventUnsubscribers.clear();
  }

  /**
   * Handle state updates from actor
   */
  private handleStateUpdate(partial: Partial<StateOf<TActor>>): void {
    // Dispatch to individual property listeners
    for (const key in partial) {
      const listeners = this.stateListeners.get(key as keyof StateOf<TActor>);
      if (listeners) {
        const value = partial[key];
        listeners.forEach(callback => callback(value));
      }
    }
  }

  /**
   * Setup effect subscriptions for this actor
   */
  private setupEffects(ActorClass: ActorConstructor<TActor>): void {
    const effectMetadata = getEffectMetadata(ActorClass);

    for (const { methodName, eventSubscriptions } of effectMetadata) {
      for (const { actorClientKey, eventName } of eventSubscriptions) {
        const depClient = this.deps[actorClientKey];

        if (!depClient) {
          console.warn(
            `Effect "${methodName}" references dependency "${actorClientKey}" which was not found in deps`
          );
          continue;
        }

        // Subscribe to the specific event on the dependency
        const callback = (payload: unknown) => {
          try {
            // Execute the effect method on the actor via mailbox (for sequential processing)
            this.actorInstance.__invokeAction(methodName, [payload]);
          } catch (error) {
            // Isolate effect errors to prevent one failing effect from blocking others
            console.error(
              `[SyncActorClient] Effect "${methodName}" failed for actor ${this.actorInstance.metadata.id}:`,
              error
            );
          }
        };

        (depClient as any).on(eventName, callback);

        // Track unsubscriber for cleanup
        this.unsubscribers.push(() => {
          (depClient as any).off(eventName, callback);
        });
      }
    }
  }

  /**
   * Create a proxy object that dynamically handles all action calls
   * Any property access returns a function that directly invokes the actor method
   */
  private createActionProxy(): ActionsOf<TActor> {
    return new Proxy({} as ActionsOf<TActor>, {
      get: (_target, prop: string) => {
        return (...args: unknown[]) => {
          // Directly invoke action on actor instance
          this.actorInstance.__invokeAction(prop, args);
        };
      }
    });
  }
}
