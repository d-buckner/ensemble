# Synchronous Main-Thread Actors: Design Proposal

## Overview

This proposal introduces a dual-execution model for the Ensemble actor framework:
- **Worker actors**: Continue using async message-passing (existing behavior)
- **Main-thread actors**: Use synchronous execution with direct method calls

Both models present the same `IActorClient<TActor>` interface to consumers, maintaining a unified developer experience regardless of where an actor runs.

## Motivation

The current async message-passing model is ideal for worker threads but creates debugging and clarity challenges on the main thread:

1. **Debugging difficulty**: Stack traces are fragmented across message boundaries
2. **State inspection**: Must wait for async state requests even for same-thread actors
3. **Mental overhead**: Unnecessary async complexity for single-threaded operations
4. **UI framework friction**: React/Vue expect synchronous state access

Main-thread actors benefit from traditional synchronous execution while maintaining actor isolation principles.

## Architecture Changes

### 1. Client Implementations

**Current (unified async):**
```
WorkerActorClient → ActorBus → ThreadBus → MainBus → Actor
```

**Proposed (dual implementation):**

```typescript
// Main thread actors (default, synchronous)
ActorClient → Direct Actor Reference

// Worker actors (async via message passing)
WorkerActorClient → ActorBus → ThreadBus → MainBus → Worker
```

Both implement the same interface:
```typescript
interface IActorClient<TActor> {
  readonly state: StateOf<TActor>;
  readonly actions: ActionsOf<TActor>;
  on<K>(eventName: K, callback: TypedListener<...>): void;
  off<K>(eventName: K, callback: TypedListener<...>): void;
  dispose(): void;
}
```

### 2. ActorClient Implementation

```typescript
export class ActorClient<TActor extends Actor<any, any, any>>
  implements IActorClient<TActor> {

  private actorRef: TActor;
  private stateListeners: EventEmitter<StateOf<TActor>>;
  private eventListeners: EventEmitter<ClientAllEvents<TActor>>;
  public readonly actions: ActionsOf<TActor>;

  constructor(actorRef: TActor) {
    this.actorRef = actorRef;
    this.stateListeners = new EventEmitter();
    this.eventListeners = new EventEmitter();
    this.actions = this.createActionProxy();
    this.subscribeToActorUpdates();
  }

  // Direct state access (no cache, no hydration needed)
  get state(): StateOf<TActor> {
    return this.actorRef.__getState();
  }

  on<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    if (eventName in this.state) {
      this.stateListeners.on(eventName, callback);
    } else {
      this.eventListeners.on(eventName, callback);
      this.actorRef.__onEvent(eventName as string, callback);
    }
  }

  off<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    if (eventName in this.state) {
      this.stateListeners.off(eventName, callback);
    } else {
      this.eventListeners.off(eventName, callback);
      this.actorRef.__offEvent(eventName as string, callback);
    }
  }

  dispose(): void {
    // Safety: Actor may already be destroyed
    if (!this.actorRef) return;

    try {
      this.actorRef.__unsubscribeStateUpdates(this.onStateUpdate);
    } catch (e) {
      // Actor destroyed, ignore
    }

    this.stateListeners.dispose();
    this.eventListeners.dispose();
  }

  private createActionProxy(): ActionsOf<TActor> {
    return new Proxy({} as ActionsOf<TActor>, {
      get: (_target, method: string) => {
        return (...args: unknown[]) => {
          // Direct synchronous method call
          (this.actorRef[method] as Function)(...args);
        };
      }
    });
  }

  private onStateUpdate = (partial: Partial<StateOf<TActor>>) => {
    for (const key in partial) {
      this.stateListeners.emit(key, partial[key]);
    }
  };

  private subscribeToActorUpdates(): void {
    this.actorRef.__onStateUpdate(this.onStateUpdate);
  }
}
```

### 3. Actor Changes

Add internal hooks for ActorClient and modify `__init` to skip action listener registration for main-thread actors:

```typescript
export abstract class Actor<TState, TEvents> {
  private stateUpdateCallbacks: Array<(partial: Partial<TState>) => void> = [];
  private internalEventEmitter = new EventEmitter<Record<string, unknown>>();

  // Internal state accessor for ActorClient
  __getState(): TState {
    return this._state;
  }

  // Internal hook for ActorClient to subscribe to state updates
  __onStateUpdate(callback: (partial: Partial<TState>) => void): void {
    this.stateUpdateCallbacks.push(callback);
  }

  // Internal hook for ActorClient to unsubscribe
  __unsubscribeStateUpdates(callback: (partial: Partial<TState>) => void): void {
    const index = this.stateUpdateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.stateUpdateCallbacks.splice(index, 1);
    }
  }

  // Internal event subscription for ActorClient
  __onEvent(eventName: string, callback: (payload: unknown) => void): void {
    this.internalEventEmitter.on(eventName, callback);
  }

  // Internal event unsubscription for ActorClient
  __offEvent(eventName: string, callback: (payload: unknown) => void): void {
    this.internalEventEmitter.off(eventName, callback);
  }

  // Modified __init to skip action listener registration for main-thread actors
  __init(bus: IActorBus<AllEvents<TState, TEvents>>, metadata: ActorMetadata): void {
    this.bus = bus;
    this._metadata = metadata;

    // Only register action listeners for worker actors
    // Main-thread actors use direct invocation (no bus/mailbox overhead)
    if (metadata.threadId !== MAIN_THREAD_ID) {
      const actionMetadata = getActionMetadata(this.constructor);

      for (const metadataEntry of actionMetadata) {
        const methodName = metadataEntry.methodName as keyof this;

        if (typeof this[methodName] === 'function') {
          this.bus.on(methodName as any, ((args: unknown[]) => {
            this.mailbox.enqueue(
              () => (this[methodName] as Function)(...args),
              {
                actorId: this._metadata.id,
                method: methodName as string,
              }
            );
          }) as any);
        }
      }
    }

    // Always register state request handler (needed for cross-thread state access)
    this.bus.on(PROTOCOL_EVENTS.STATE_REQUEST as any, () => {
      // For main-thread actors: respond immediately
      // For worker actors: queue in mailbox
      const handleStateRequest = () => {
        this.bus.emit(PROTOCOL_EVENTS.STATE as any, this._state);
      };

      if (metadata.threadId === MAIN_THREAD_ID) {
        handleStateRequest();
      } else {
        this.mailbox.enqueue(handleStateRequest, {
          actorId: this._metadata.id,
          method: '__state_request',
        });
      }
    });
  }

  // Modified emit to support both bus (cross-thread) and internal emitter (same-thread)
  protected emit<K extends keyof TEvents>(
    eventName: K,
    payload: DeepReadonly<TEvents[K]>
  ): void {
    if (process.env.NODE_ENV !== 'production') {
      Object.freeze(payload);
    }

    // Emit via bus for cross-thread communication
    this.bus?.emit(eventName as string | number, payload);

    // Emit via internal emitter for same-thread ActorClients
    this.internalEventEmitter.emit(eventName as string, payload);
  }

  private updateStateBatch() {
    const batchUpdater = (draft: Draft<TState>) => {
      this.stateUpdateQueue.forEach(updater => {
        updater(draft);
      });
      this.stateUpdateQueue = [];
    };

    const [nextState, patches] = produceWithPatches(this._state, batchUpdater);

    if (nextState === this._state) {
      return; // No changes
    }

    this._state = nextState;

    // Build batched partial
    const partial: Partial<TState> = {};
    patches.forEach(patch => {
      if (patch.path.length > 0) {
        const key = patch.path[0] as keyof TState;
        partial[key] = this._state[key];
      }
    });

    // Emit via bus for worker clients / cross-thread
    this.bus?.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);

    // Notify direct subscribers (ActorClient state listeners)
    this.stateUpdateCallbacks.forEach(cb => cb(partial));
  }
}
```

### 4. ActorSystem Changes

```typescript
class ActorSystem {
  private async instantiateActor(actorId: string): Promise<void> {
    const node = this.graph[actorId];
    const { token, actor: ActorClass, threadId, dependencies = {} } = node;

    if (threadId !== MAIN_THREAD_ID) {
      // Worker actor: existing async implementation unchanged
      const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);
      const client = new WorkerActorClient(actorBus, ActorClass.initialState);
      this.clients.set(token.symbol, client);
      // ... worker instantiation ...
      return;
    }

    // Main-thread actor: synchronous implementation
    const actorInstance = new ActorClass();

    // ActorBus still created for:
    // 1. Cross-thread communication (workers can call main-thread actors)
    // 2. Protocol events (errors, etc.)
    const actorBus = new ActorBus<AllEvents<any, any>>(this.mainBus!, actorId);
    actorInstance.__init(actorBus, metadata);

    // Build dependencies (may be mix of ActorClient and WorkerActorClient)
    const deps: Record<string, IActorClient<any>> = {};
    for (const [depName, depToken] of Object.entries(dependencies)) {
      deps[depName] = this.clients.get(depToken.symbol)!;
    }

    if (Object.keys(deps).length > 0) {
      (actorInstance as any).deps = deps;
    }

    this.instances.set(token.symbol, actorInstance);

    // Create ActorClient for main-thread actor (synchronous)
    const client = new ActorClient(actorInstance);
    this.clients.set(token.symbol, client);

    this.setupEffects(actorInstance, ActorClass, deps);

    if (actorInstance.onInit) {
      await actorInstance.onInit();
    }
  }
}
```

### 5. Effect Setup for Sync Actors

```typescript
private setupEffects(
  actorInstance: Actor,
  ActorClass: ActorConstructor,
  deps: Record<string, IActorClient<any>>
): void {
  const effectMetadata = getEffectMetadata(ActorClass);

  for (const { methodName, eventSubscriptions } of effectMetadata) {
    for (const { actorClientKey, eventName } of eventSubscriptions) {
      const depClient = deps[actorClientKey];

      if (!depClient) {
        Logger.error(
          `Effect "${methodName}" references dependency "${actorClientKey}" which was not found`
        );
        continue;
      }

      // Subscribe to the dependency's event
      (depClient as any).on(eventName, (payload: unknown) => {
        // For main-thread actors: direct call (no mailbox)
        // For worker actors: mailbox enqueue (existing behavior)

        if (actorInstance.metadata.threadId === MAIN_THREAD_ID) {
          // Direct synchronous effect invocation with error context tracking
          const actor = actorInstance as unknown as Record<string, unknown>;
          if (typeof actor[methodName] === 'function') {
            actorInstance.__setContext('effect', methodName);
            try {
              (actor[methodName] as (payload: unknown) => void)(payload);
            } finally {
              actorInstance.__clearContext();
            }
          }
        } else {
          // Async mailbox enqueue for worker actors
          actorInstance.mailbox.enqueue(
            () => {
              const actor = actorInstance as unknown as Record<string, unknown>;
              if (typeof actor[methodName] === 'function') {
                (actor[methodName] as (payload: unknown) => void)(payload);
              }
            },
            {
              actorId: actorInstance.metadata.id,
              method: methodName,
            }
          );
        }
      });
    }
  }
}
```

## Execution Model

### Bus and Mailbox Usage

**Key principle**: Main-thread actors skip the bus and mailbox for same-thread communication, but keep them for cross-thread support.

**For Main-Thread Actors:**

| Communication Type | Uses Bus? | Uses Mailbox? | Execution |
|-------------------|-----------|---------------|-----------|
| Same-thread action call (main → main) | ❌ No | ❌ No | Direct sync call |
| Same-thread state access | ❌ No | ❌ No | Direct property access |
| Same-thread events | ❌ No (internal emitter) | ❌ No | Direct sync emission |
| Main → Worker action call | ✅ Yes | ✅ Yes (worker) | Async via bus |
| Worker → Main action call | ❌ Not supported | ❌ N/A | Use events instead |
| Cross-thread events (any direction) | ✅ Yes | ❌ No | Async via bus |
| State requests (any direction) | ✅ Yes | ❌ No | Sync response |

**Rationale:**
- **Bus is skipped** for same-thread communication to eliminate serialization/routing overhead
- **Bus is kept** for cross-thread communication (main thread calling workers, events in both directions)
- **Mailbox is skipped** for main-thread actors because the call stack provides natural sequential execution
- **Mailbox is kept** for worker actors to handle async message queueing
- **Worker → Main action calls** are not supported to maintain clear directional control flow (main orchestrates, workers report)

**Implementation:**
- `Actor.__init()` skips action listener registration when `threadId === MAIN_THREAD_ID`
- `ActorClient` invokes methods directly (bypasses bus)
- State requests via bus respond immediately (no mailbox queue)

### State Listeners vs Effects

Two mechanisms exist for reacting to state changes, with different purposes and execution timing:

**State Listeners** (`client.on('stateProp', callback)`):
- **Purpose**: For external observers (UI components, tests, logging, monitoring)
- **Timing**: Fire immediately when state flushes
- **Ordering**: No ordering guarantees between different listeners (treated as independent observers)
- **Contract**: Should be read-only (do not modify actor state or call actions)
- **Example**:
  ```typescript
  // UI component observing state
  client.on('count', (count) => {
    updateDisplay(count); // Read-only observation
  });
  ```

**Effects** (`@effect(deps.actor, 'event')`):
- **Purpose**: For inter-actor communication and reactive state propagation
- **Timing**: Fire after state listeners, in the same microtask
- **Ordering**: Execute in dependency order (guaranteed by ActorSystem graph)
- **Contract**: Can call actions and modify state (triggers new propagation wave)
- **Example**:
  ```typescript
  @effect(deps.userActor, 'name')
  onNameChange(name: string) {
    this.setState(d => d.displayName = formatName(name)); // Can modify state
  }
  ```

**Execution Order (Single Microtask):**
1. State flushes (Immer produces new state)
2. State listeners notified (parallel, no ordering)
3. Effects execute (dependency-ordered, sequential)

**Why This Matters:**
- State listeners see the new state first (for immediate UI updates)
- Effects run after (for derived state computation and cross-actor reactions)
- Effects can trigger new state changes (queued for next microtask)
- State listeners cannot trigger new state changes (keep observers pure)

### Timeline

```typescript
// User code
client.actions.updateUser({ name: 'Alice', email: 'alice@example.com' });
console.log('Action called');

// Execution flow:
// 1. [Sync] updateUser() executes directly on actor instance
// 2. [Sync] setState() calls are queued (not applied yet)
// 3. [Sync] action method returns
// 4. [Sync] console.log executes: "Action called"
//
// --- Microtask boundary ---
//
// 5. [Microtask] State batch flushes (Immer produces new state)
// 6. [Microtask] STATE_PARTIAL emitted via bus (for worker clients if any)
// 7. [Microtask] State listeners notified (ActorClient.on('stateProp', ...) callbacks)
// 8. [Microtask] Effects execute (dependency-ordered)
// 9. [Microtask] If effects call actions, new state updates queue for next microtask
```

### State Batching

- **Actions execute synchronously** and return immediately
- **State updates queue** during action execution (via `setState()`)
- **Flush happens on microtask** (same batching pattern as React/Vue)
- **Multiple setState calls** in one action → single state update + single emission

**Example:**
```typescript
@action
updateUser(user: User) {
  this.setState(draft => { draft.name = user.name; });
  this.setState(draft => { draft.email = user.email; });
  this.setState(draft => { draft.avatar = user.avatar; });
  // All three calls batch into single update on next microtask
}
```

### State Visibility

**IMPORTANT**: `this._state` is **stale during action execution** and only reflects the last flushed value.

**During action execution:**
```typescript
@action
increment() {
  console.log(this._state.count); // 5 (last flushed value)
  this.setState(draft => { draft.count = 10 });
  console.log(this._state.count); // Still 5 (NOT 10 - update queued but not applied)

  // If you need the new value, use a local variable:
  const newCount = this._state.count + 1;
  this.setState(draft => { draft.count = newCount });
  this.doSomethingWith(newCount); // Use local variable, not this._state.count
}
```

**After action completes:**
```
// --- Microtask boundary ---
// State batch flushes
// Now this._state.count is 10
// Observers are notified
```

**Key Points:**
- **Internal state** (`this._state`): Reflects last flushed value only
- **External state** (`client.state`): Also reflects last flushed value only
- **Queued updates**: Not visible until microtask flush
- **Best practice**: Use local variables if you need computed values during action execution

**Rationale**: This matches React's `useState` behavior where updates are batched and only visible after the current execution completes. It keeps batching simple (single Immer production) and prevents complex state synchronization issues.

### Effect Batching

- Effects triggered by the **same state flush** are **batched together**
- Execute in **dependency order** (guaranteed by ActorSystem dependency graph)
- Run in the **same microtask** as the state flush that triggered them
- Effects that call actions will queue new state updates for the **next microtask**

**Example:**
```typescript
// ActorA changes state
// Three actors have effects on this state:
// - ActorB (no deps on other listeners)
// - ActorC (depends on ActorB)
// - ActorD (depends on ActorC)

// Effects run in dependency order:
// 1. ActorB's effect
// 2. ActorC's effect
// 3. ActorD's effect
// All in the same microtask
```

### Effect Execution Waves

If effects trigger state changes that trigger more effects, execution proceeds in waves:

```typescript
// Wave 1 (Microtask 1):
ActorA.setState(...) → flushes → ActorB.effect runs → ActorB.setState(...)

// Wave 2 (Microtask 2):
ActorB.setState(...) → flushes → ActorC.effect runs → ActorC.setState(...)

// Wave 3 (Microtask 3):
ActorC.setState(...) → flushes → ActorD.effect runs

// Continues until no more state changes
```

### Cross-Thread Boundaries

**Main → Worker:**
```typescript
// Main-thread actor calls worker actor action
this.deps.workerActor.actions.process(data);
// Returns immediately (fire-and-forget)
// Message sent to worker
// Worker processes asynchronously
```

**Worker → Main:**
```typescript
// Main-thread actor subscribes to worker event
@effect(deps.workerActor, 'completed')
onWorkerCompleted(result) {
  // This effect is async (waits for worker message)
  // Runs when message arrives from worker
}
```

**State from worker actors:**
- Worker state is cached in `WorkerActorClient` (may be stale)
- State hydration happens asynchronously on client creation
- State updates arrive via `STATE_PARTIAL` messages from worker

**Main-thread actor depending on worker actor:**
```typescript
interface MainThreadActions {}

class MainThreadActor extends Actor<State, MainThreadActions, Events> {
  // deps.workerActor is WorkerActorClient (async)
  // deps.mainThreadActor is ActorClient (sync, main thread)

  @effect(this.deps.workerActor, 'result')
  onWorkerResult(result) {
    // This is async - waits for worker message
    // Natural async boundary
  }

  @effect(this.deps.mainThreadActor, 'update')
  onMainUpdate(data) {
    // This is sync - runs immediately on state flush
  }
}
```

## Benefits

### Performance
- **No serialization** for main-thread communication
- **No message overhead** (bus/mailbox bypassed for actions)
- **Direct method calls** (V8 can inline/optimize)
- **Estimated improvement**: ~10-50μs per action (eliminates bus routing + mailbox queueing)

### Developer Experience
- **Synchronous debugging**: Full stack traces with no async boundaries
- **Immediate state access**: No waiting for state hydration or requests
- **Familiar model**: Like Redux/MobX/Vuex for main-thread state
- **Same API**: `IActorClient` interface works identically for sync and async actors

### Maintainability
- **Clear isolation**: Still can't reach into actor internals directly
- **Same abstractions**: Actions, state, events work the same way
- **Flexible deployment**: Easy to move actors between main/worker threads (just change decorator)

### Architecture
- **Enforced boundaries**: Dependency graph prevents cycles
- **Predictable execution**: Dependency-ordered effects guarantee consistent state flow
- **Natural async boundaries**: Cross-thread communication is clearly async

## Migration & Compatibility

### Backward Compatibility
- ✅ Existing actors work unchanged
- ✅ Default thread is main thread (now synchronous)
- ✅ Worker actors use `@thread('worker-id')` (unchanged)
- ✅ All existing tests should pass without modification

### Migration Path
1. **Phase 1**: Rename current `ActorClient` to `WorkerActorClient`
2. **Phase 2**: Implement new synchronous `ActorClient` for main-thread actors
3. **Phase 3**: Update `ActorSystem.instantiateActor` to choose implementation based on `threadId`
4. **Phase 4**: Update `Actor` base class with internal hooks
5. **Phase 5**: No user code changes required - automatically uses sync for main thread

### Moving Actors Between Threads

**To worker:**
```typescript
interface DataProcessorActions {}

// Before: Main thread (sync)
class DataProcessor extends Actor<State, DataProcessorActions, Events> {
  // ...
}

// After: Worker thread (async)
@thread('background-worker')
class DataProcessor extends Actor<State, DataProcessorActions, Events> {
  // No other changes needed
  // Client code unchanged (same IActorClient interface)
}
```

**To main thread:**
```typescript
interface UIStateManagerActions {}

// Before: Worker thread
@thread('background-worker')
class UIStateManager extends Actor<State, UIStateManagerActions, Events> {
  // ...
}

// After: Main thread (just remove decorator)
class UIStateManager extends Actor<State, UIStateManagerActions, Events> {
  // Automatically becomes synchronous
}
```

## Edge Cases & Considerations

### 1. Reentrancy Prevention

**Can an actor call itself via dependency chain?**

**Answer**: No. The dependency graph prevents cycles:
```typescript
// This is invalid and caught by validateAcyclic():
ActorA depends on ActorB
ActorB depends on ActorA  // ERROR: Cycle detected
```

The topological validation ensures no actor can trigger itself through effects.

### 2. Recursive Actions (Same Actor)

**Can an action call another action on the same actor?**

```typescript
@action
doA() {
  this.setState(d => d.count++);
  this.doB(); // Direct call to another action
}

@action
doB() {
  this.setState(d => d.value++);
}
```

**Answer**: ✅ Yes, this works fine.
- Both actions execute synchronously
- Both `setState` calls queue updates
- Single state flush happens on microtask with all changes

### 3. Effect Chains

**What if an effect's setState triggers another effect?**

```typescript
// ActorA
@action updateData() {
  this.setState(d => d.data = newData);
}

// ActorB
@effect(deps.actorA, 'data')
onDataChange() {
  this.setState(d => d.derived = computeDerived());
  // This could trigger ActorC's effect on 'derived'
}

// ActorC
@effect(deps.actorB, 'derived')
onDerivedChange() {
  this.setState(d => d.final = computeFinal());
}
```

**Answer**: Executes in waves across microtasks:
- **Microtask 1**: ActorA state flush → ActorB effect runs → queues ActorB state update
- **Microtask 2**: ActorB state flush → ActorC effect runs → queues ActorC state update
- **Microtask 3**: ActorC state flush → complete

Each wave is a separate microtask, preventing stack overflow and maintaining predictable execution.

### 4. State During Effect Execution

**When do state listeners see updates made during effect execution?**

```typescript
@effect(deps.actorB, 'data')
onDataChange(data) {
  this.setState(d => d.processed = true);
}

// Elsewhere
actorA.on('processed', (value) => {
  console.log('Processed changed:', value);
});
```

**Answer**: The listener runs on the **next microtask**:
- Current microtask: Effect runs, queues `setState`
- Effect returns
- Next microtask: State flushes, listener is notified

### 5. Action Invocation Paths

**How can actions be invoked on main-thread actors?**

**For same-thread calls (main → main):**
```typescript
client.actions.updateUser(user);
// → ActorClient directly calls actor method
// → Synchronous execution
// → No bus, no mailbox
```

**For cross-thread calls (worker → main):**
Cross-thread action invocations are **not supported** in this design because:
- Main-thread actors don't register bus listeners for actions (optimization)
- Workers can only communicate with main thread via events, not action calls
- This maintains clear directional flow: main thread controls workers, not vice versa

**Supported cross-thread patterns:**
```typescript
// ✅ Worker emits event, main-thread actor has effect
// Worker actor:
this.emit('dataProcessed', result);

// Main-thread actor:
@effect(deps.workerActor, 'dataProcessed')
onDataProcessed(result) {
  // React to worker event
}

// ✅ Main-thread calls worker action
// Main-thread actor:
this.deps.workerActor.actions.processData(data);

// ❌ Worker cannot call main-thread action
// Workers should emit events instead
```

**Rationale**: This asymmetry is intentional - main thread orchestrates workers, workers report back via events. This prevents complex bidirectional async dependencies and keeps the mental model simple.

### 6. Custom Event Emission

**How do custom events work for main-thread actors?**

```typescript
@action
processData(data: Data) {
  // ... processing ...
  this.emit('dataProcessed', result);
}
```

**Answer**: Dual emission:
- **Internal emitter**: For same-thread `ActorClient` listeners (synchronous)
- **Bus emission**: For cross-thread listeners (asynchronous)

Both paths are active, ensuring events work regardless of subscriber location.

### 7. Error Handling

**Should errors be synchronous or asynchronous?**

```typescript
@action
riskyOperation() {
  if (invalid) {
    this.throw('Invalid operation', details);
  }
}
```

**Current behavior**: `this.throw()` emits an error event via bus.

**Proposed behavior** (same for sync actors):
- Error emitted as event (via both internal emitter and bus)
- Same-thread listeners receive error synchronously
- Cross-thread listeners receive error asynchronously
- Error does **not** throw an exception (consistent with actor model)

**Rationale**: Errors as events maintains consistency and allows actors to remain operational while notifying observers.

### 8. Lifecycle Hooks

**How do async lifecycle hooks work with sync actors?**

```typescript
interface MyActorActions {}

class MyActor extends Actor<State, MyActorActions, Events> {
  async onInit() {
    await this.loadData(); // Async operation
  }
}
```

**Behavior**:
- `onInit` is called during `ActorSystem.start()`
- Actor is not usable until `onInit` completes (awaited by ActorSystem)
- Actions cannot be called until actor is fully initialized

**Order**:
1. Actor instance created
2. Dependencies injected
3. Effects set up
4. `onInit` called and awaited
5. Actor ready for action calls

### 9. Message Monitoring & Debugging

**How do we monitor/visualize main-thread actor communication?**

**Current**: `setMessageMonitor()` observes all bus messages.

**Issue**: Direct method calls bypass the bus, so main-thread actions aren't monitored.

**Solution**: Add optional monitoring hooks to `ActorClient`:

```typescript
class ActorClient {
  private monitor?: (event: MonitorEvent) => void;

  setMonitor(monitor: (event: MonitorEvent) => void) {
    this.monitor = monitor;
  }

  private createActionProxy() {
    return new Proxy({}, {
      get: (_, method: string) => {
        return (...args: unknown[]) => {
          // Optional monitoring
          this.monitor?.({
            type: 'action',
            actorId: this.actorRef.metadata.id,
            method,
            args,
            timestamp: Date.now()
          });

          (this.actorRef[method] as Function)(...args);
        };
      }
    });
  }
}
```

This allows devtools/visualization to monitor main-thread actors without production overhead.

### 10. Mixed Dependencies

**What if an actor has both main-thread and worker dependencies?**

```typescript
interface HybridActions {
  refresh(): void;
}

class HybridActor extends Actor<State, HybridActions, Events> {
  declare deps: {
    uiState: IActorClient<UIStateActor>;      // ActorClient (main thread, sync)
    dataWorker: IActorClient<DataWorkerActor>; // WorkerActorClient (worker, async)
  }

  @action
  refresh() {
    // Sync access to main-thread actor
    const filter = this.deps.uiState.state.filter;

    // Async call to worker
    this.deps.dataWorker.actions.fetchData(filter);
  }

  @effect(this.deps.uiState, 'filter')
  onFilterChange(filter: string) {
    // Sync effect (same thread)
  }

  @effect(this.deps.dataWorker, 'dataReady')
  onDataReady(data: Data) {
    // Async effect (cross thread)
  }
}
```

**Answer**: ✅ Works seamlessly.
- Both implement `IActorClient` interface
- Type system doesn't differentiate (same API)
- Execution model adapts automatically (sync for same-thread, async for cross-thread)

## Implementation Checklist

### Core Implementation

- [ ] Rename current `/packages/core/src/core/ActorClient.ts` to `WorkerActorClient.ts`
- [ ] Create new synchronous `ActorClient` class in `/packages/core/src/core/ActorClient.ts`
  - [ ] Add null check safety in `dispose()` method
- [ ] Add internal accessor methods to `Actor` base class:
  - [ ] `__getState()`
  - [ ] `__onStateUpdate(callback)`
  - [ ] `__unsubscribeStateUpdates(callback)`
  - [ ] `__onEvent(eventName, callback)`
  - [ ] `__offEvent(eventName, callback)`
- [ ] Modify `Actor.__init()` to skip action listener registration for main-thread actors
- [ ] Update `Actor.__init()` to handle state requests without mailbox for main-thread actors
- [ ] Update `Actor.emit()` to use dual emission (bus + internal emitter)
- [ ] Update `Actor.updateStateBatch()` to notify state update callbacks
- [ ] Modify `ActorSystem.instantiateActor()` to choose client type based on `threadId`
- [ ] Update `ActorSystem.setupEffects()` to:
  - [ ] Handle sync vs async effect invocation
  - [ ] Add `__setContext`/`__clearContext` wrapping for sync effects

### Testing

- [ ] Unit tests for `ActorClient`
  - [ ] State access
  - [ ] Action invocation
  - [ ] Event subscription
  - [ ] Disposal
- [ ] Integration tests for sync actors
  - [ ] State batching behavior
  - [ ] Effect batching and ordering
  - [ ] State listeners vs effects ordering (listeners fire first, then effects)
  - [ ] Action execution (sync)
  - [ ] Custom event emission
  - [ ] State visibility during action execution (stale until flush)
- [ ] Cross-thread integration tests
  - [ ] Main-thread actor depending on worker
  - [ ] Worker actor depending on main-thread actor
  - [ ] Mixed dependencies
- [ ] Effect chain tests
  - [ ] Multi-wave state propagation
  - [ ] Dependency-ordered execution
- [ ] Lifecycle tests
  - [ ] `onInit` with async operations
  - [ ] `onDestroy` cleanup
  - [ ] Client disposal

### Documentation

- [ ] Document execution model (sync vs async)
- [ ] Document bus and mailbox usage for main-thread vs worker actors
- [ ] Document state listeners vs effects (purpose, timing, ordering)
- [ ] Document state batching behavior
- [ ] Document state visibility during action execution (stale state caveat)
- [ ] Document effect execution timing
- [ ] Document cross-thread considerations and limitations (no worker → main actions)
- [ ] Update API reference for `IActorClient`
- [ ] Add migration guide
- [ ] Add examples of sync actor patterns

### Performance Validation

- [ ] Benchmark action invocation (sync vs async)
- [ ] Benchmark state access (direct vs cached)
- [ ] Benchmark effect chains (sync vs async)
- [ ] Profile memory usage (direct refs vs message passing)

## Open Questions

1. **Should we expose monitoring hooks in public API?**
   - **Option A**: Add `client.setMonitor()` to `IActorClient`
   - **Option B**: Keep as internal detail for devtools only
   - **Recommendation**: Option B initially, add to public API if needed

2. **Should error emission also throw exceptions in dev mode?**
   - **Pro**: Easier debugging with stack traces
   - **Con**: Changes behavior between dev/prod
   - **Recommendation**: Keep as events only, rely on monitoring for debugging

## Future Enhancements

1. **Transaction API** for multi-property updates:
   ```typescript
   this.transaction(draft => {
     draft.name = 'Alice';
     draft.email = 'alice@example.com';
     draft.avatar = avatarUrl;
   });
   // Guaranteed single update, no intermediate states
   ```

2. **Computed properties** with automatic dependency tracking:
   ```typescript
   @computed
   get fullName() {
     return `${this._state.firstName} ${this._state.lastName}`;
   }
   ```

3. **Optimistic updates** for cross-thread calls:
   ```typescript
   await this.deps.workerActor.actions.save(data);
   // Optionally await worker response
   ```

4. **Time-travel debugging** for main-thread actors:
   - Record all state transitions
   - Replay action sequences
   - Visualize state flow

## Conclusion

This proposal maintains the actor model's isolation guarantees while providing synchronous execution for main-thread actors. The dual-implementation strategy keeps the developer experience consistent while optimizing for the execution context.

Key advantages:
- ✅ Same `IActorClient` API for all actors
- ✅ Synchronous debugging for main-thread actors
- ✅ Async execution for worker actors (unchanged)
- ✅ Flexible deployment (easy to move actors between threads)
- ✅ Performance improvement for main-thread operations
- ✅ Maintains isolation and dependency graph guarantees
