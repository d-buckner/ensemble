# Ensemble Core Architecture

This document explains the key architectural patterns and design decisions in the Ensemble actor system.

---

## Table of Contents

- [Dual Emission Pattern](#dual-emission-pattern)
- [Synchronous vs Asynchronous Clients](#synchronous-vs-asynchronous-clients)
- [Optional Bus Design](#optional-bus-design)
- [Effect Ownership](#effect-ownership)
- [Thread-Level State Batching](#thread-level-state-batching)

---

## Dual Emission Pattern

### Problem

The actor system needs to support two execution contexts:
- **Main-thread actors**: Run synchronously on the main thread
- **Worker-thread actors**: Run asynchronously in web workers

These contexts have different communication requirements:
- **Same-thread**: Direct function calls via EventEmitter
- **Cross-thread**: Message passing via bus (serialization required)

### Solution: Dual Emission

Every event is emitted to **both** channels simultaneously:

```typescript
// In Actor.ts
protected emit<K extends keyof TEvents>(
  eventName: K,
  payload: DeepReadonly<TEvents[K]>
): void {
  // 1. Emit to internal EventEmitter (same-thread subscribers)
  this.internalEventEmitter.emit(eventName as unknown as keyof AllEvents<TState, TEvents>, payload as any);

  // 2. Emit to bus if present (cross-thread subscribers)
  if (this.bus) {
    this.bus.emit(eventName as string | number, payload);
  }
}
```

### Why This Works

1. **Main-thread actors** (`bus === undefined`):
   - Only the `internalEventEmitter.emit()` executes
   - `SyncActorClient` subscribes via `__registerInternalListener()`
   - No serialization overhead
   - Direct, synchronous communication

2. **Worker-thread actors** (`bus !== undefined`):
   - Both emissions execute
   - Internal emission: Handles same-thread effects (effects on self)
   - Bus emission: Broadcasts to main thread and other workers
   - `AsyncActorClient` subscribes via bus
   - Serialization happens at bus boundary

### Benefits

✅ **No conditional logic in actor code**: Actor doesn't need to know its execution context

✅ **Unified implementation**: Same `emit()` code works everywhere

✅ **Performance**: Bus only created when needed

✅ **Correctness**: Can't forget to emit to one channel or the other

✅ **Testability**: Easy to mock either channel independently

### Implementation Details

The dual emission pattern is used in three places in `Actor.ts`:

1. **State updates** (`__emitStateChanges()`):
   ```typescript
   this.internalEventEmitter.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);
   if (this.bus) {
     this.bus.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);
   }
   ```

2. **Custom events** (`emit()`):
   ```typescript
   this.internalEventEmitter.emit(eventName, payload);
   if (this.bus) {
     this.bus.emit(eventName, payload);
   }
   ```

3. **Error events** (`throw()`):
   ```typescript
   this.internalEventEmitter.emit('error', errorPayload);
   if (this.bus) {
     this.bus.emit('error', errorPayload);
   }
   ```

---

## Synchronous vs Asynchronous Clients

The actor system provides two client implementations that satisfy the same `IActorClient<TActor>` interface:

### SyncActorClient (Main-Thread)

**Location**: `src/core/SyncActorClient.ts`

**Characteristics**:
- Direct reference to actor instance
- State access via `__getState()` (no caching)
- Actions invoke via `__invokeAction()` (still goes through mailbox)
- Events subscribe via `__registerInternalListener()`
- Effects managed internally in client
- **Zero serialization overhead**

**Use Case**: Actors running on the main thread

```typescript
const client = new SyncActorClient(actorInstance, deps, ActorClass);
client.state; // Direct access to actor._state
client.actions.doSomething(); // Direct invocation
```

### AsyncActorClient (Worker-Thread)

**Location**: `src/core/ActorClient.ts` (exported as both `AsyncActorClient` and `ActorClient`)

**Characteristics**:
- State cache kept in sync via `__state_partial` events
- State access via cached copy
- Actions emit via `bus.emit()`
- Events subscribe via `bus.on()`
- Requires state hydration on startup
- **Message passing with serialization**

**Use Case**: Actors running in web workers

```typescript
const client = new AsyncActorClient(actorBus, ActorClass.initialState);
client.state; // Returns cached copy
client.actions.doSomething(); // Emits to bus
```

### Interface Contract

Both clients implement `IActorClient<TActor>`:

```typescript
interface IActorClient<TActor> {
  readonly state: StateOf<TActor>;
  on(eventName, callback): void;
  off(eventName, callback): void;
  dispose(): void;
  readonly actions: ActionsOf<TActor>;
}
```

This unified interface means:
- **Same DX** for both client types
- **Type-safe** action calls and event subscriptions
- **Transparent** to consumer code which client type they're using

### Type Guard

Use `isAsyncActorClient()` to distinguish at runtime:

```typescript
import { isAsyncActorClient } from '@d-buckner/ensemble-core';

if (isAsyncActorClient(client)) {
  // client is AsyncActorClient
  client.hydrateState(newState);
} else {
  // client is SyncActorClient
  // Direct access, no hydration needed
}
```

---

## Optional Bus Design

### Problem

In the original design, every actor had a bus, even main-thread actors. This created "zombie resources" - infrastructure that was created but never used.

### Solution: Optional Bus

The bus is now optional in the `Actor` class:

```typescript
// Before: Bus always exists
public bus!: IActorBus<AllEvents<TState, TEvents>>;

// After: Bus is optional
public bus?: IActorBus<AllEvents<TState, TEvents>>;
```

### Initialization Signature

The `__init()` signature changed to reflect this:

```typescript
// Before: Bus required, metadata second
__init(bus: IActorBus, metadata: ActorMetadata): void

// After: Metadata required, bus optional
__init(metadata: ActorMetadata, bus?: IActorBus): void
```

**Rationale**: Metadata is always needed; bus is only needed for worker threads.

### Early Return Pattern

Worker-thread setup code uses early return for clean control flow:

```typescript
__init(metadata: ActorMetadata, bus?: IActorBus): void {
  this._metadata = metadata;
  this.bus = bus;

  // Early return for main-thread actors
  if (!this.bus) {
    return;
  }

  // Worker-thread setup continues...
  this.bus.on(PROTOCOL_EVENTS.STATE_REQUEST, ...);
  // etc.
}
```

### Benefits

✅ **No zombie resources**: Bus only exists when needed

✅ **Type system enforcement**: Optional bus catches bugs at compile time

✅ **Clearer mental model**: "Only worker actors have buses"

✅ **Reduced memory footprint**: Main-thread actors are lighter

---

## Effect Ownership

### Problem

In the original design, `ActorSystem` had a `setupEffects()` method with branching logic to handle main-thread vs worker-thread effects differently.

### Solution: Client-Owned Effects

Each client type now manages its own effect subscriptions:

**SyncActorClient**:
```typescript
private setupEffects(ActorClass: ActorConstructor<TActor>): void {
  const effectMetadata = getEffectMetadata(ActorClass);

  for (const { methodName, eventSubscriptions } of effectMetadata) {
    for (const { actorClientKey, eventName } of eventSubscriptions) {
      const depClient = this.deps[actorClientKey];

      // Subscribe via dependency's on() method
      const callback = (payload: unknown) => {
        this.actorInstance.__invokeAction(methodName, [payload]);
      };

      depClient.on(eventName as any, callback);

      // Track for cleanup
      this.unsubscribers.push(() => {
        depClient.off(eventName as any, callback);
      });
    }
  }
}
```

**WorkerRuntime** (for worker-thread actors):
```typescript
private setupEffects(actorInstance, ActorClass, deps): void {
  // Similar logic, but specific to worker environment
  // Effects registered on actor instance in worker thread
}
```

### Benefits

✅ **Single Responsibility Principle**: Client that manages subscriptions also manages effects

✅ **No branching in ActorSystem**: Each client knows how to setup its own effects

✅ **Better encapsulation**: Effect logic stays with the client that needs it

✅ **Easier testing**: Can test effect setup in isolation per client type

✅ **Eliminated ~45 lines**: Removed complex branching logic from ActorSystem

---

## Thread-Level State Batching

### Problem

When multiple actors update state in response to the same event, observers can see **partial updates** - intermediate states where some actors have updated but others haven't yet. This violates the principle of atomic visibility and can lead to inconsistent UI renders or derived state.

**Example scenario**:
```typescript
// Source actor changes
sourceActor.setValue(10);

// Two derived actors react via effects
// DerivedA: doubled = 10 * 2 = 20
// DerivedB: tripled = 10 * 3 = 30

// Problem: Observer might see (doubled: 20, tripled: 0) - partial update!
```

Additionally, multiple `setState()` calls within a single actor should be batched to minimize re-renders and event emissions.

### Solution: Two-Phase Flushing with Thread Coordinator

The framework uses **thread-level coordination** to batch all state updates and ensure atomic visibility:

1. **ThreadContext**: Static utility providing thread-local access to coordinator
2. **ThreadStateCoordinator**: Coordinates state flushing across all actors on a thread
3. **Two-phase flushing**: Apply all updates first, then emit all events

### Architecture Overview

```typescript
// ThreadContext.ts - Thread-local service access
export class ThreadContext {
  private static coordinator?: ThreadStateCoordinator;

  static get current(): ThreadStateCoordinator {
    return this.coordinator; // Throws if not initialized
  }

  static initialize(coordinator: ThreadStateCoordinator): void {
    this.coordinator = coordinator;
  }
}

// ThreadStateCoordinator.ts - Batch coordinator
export class ThreadStateCoordinator {
  private actorsWithPendingUpdates = new Set<Actor>();
  private flushScheduled = false;

  scheduleFlush(actor: Actor): void {
    this.actorsWithPendingUpdates.add(actor);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    // Phase 1: Apply all state updates
    const partialStates = new Map();
    for (const actor of this.actorsWithPendingUpdates) {
      const partial = actor.__applyPendingStateUpdates();
      if (partial) partialStates.set(actor, partial);
    }

    // Phase 2: Emit all state change events
    for (const [actor, partial] of partialStates) {
      actor.__emitStateChanges(partial);
    }
  }
}
```

### How It Works

#### 1. Actor.setState() Schedules Flush

```typescript
// In Actor.ts
protected setState(updater: (draft: Draft<TState>) => void): void {
  this.stateUpdateQueue.push(updater);

  if (this.stateUpdateQueue.length === 1) {
    // First update - schedule flush via thread coordinator
    ThreadContext.current.scheduleFlush(this);
  }
}
```

#### 2. Coordinator Batches Actors

All actors calling `setState()` in the same synchronous execution context are added to the coordinator's `Set`. Only **one microtask** is scheduled regardless of how many actors update.

#### 3. Two-Phase Flushing Ensures Atomicity

**Phase 1 - Apply Updates** (`__applyPendingStateUpdates()`):
```typescript
__applyPendingStateUpdates(): Partial<TState> | null {
  // Batch all queued updates using Mutative
  const [nextState, patches] = create(this._state, draft => {
    this.stateUpdateQueue.forEach(updater => updater(draft));
    this.stateUpdateQueue = [];
  }, { enablePatches: true });

  this._state = nextState;

  // Build partial for Phase 2
  const partial = extractChangedKeys(patches);
  return partial;
}
```

**Phase 2 - Emit Events** (`__emitStateChanges()`):
```typescript
__emitStateChanges(partial: Partial<TState>): void {
  // Dual emission pattern
  this.internalEventEmitter.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);
  if (this.bus) {
    this.bus.emit(PROTOCOL_EVENTS.STATE_PARTIAL, partial);
  }
}
```

**Key insight**: By the time Phase 2 starts, **all actors have their updated state**. Observers reading state during event callbacks see a consistent snapshot.

#### 4. BFS Effect Propagation

Effects triggered during Phase 2 may call `setState()` on other actors. These new updates:
- Are added to a fresh `Set` (Phase 1 cleared the previous batch)
- Schedule a **new microtask** for the next flush wave
- Propagate in **breadth-first** fashion across microtask cycles

```
Microtask 1: Source updates → emits → triggers effects on DerivedA/B
Microtask 2: DerivedA/B update → emit → triggers effects on Composite
Microtask 3: Composite updates → emits
```

### Benefits

✅ **Atomic Visibility**: Observers never see partial updates across actors

✅ **Automatic Batching**: Multiple `setState()` calls → single emission per actor

✅ **BFS Propagation**: State changes propagate in waves through dependency graphs

✅ **Zero Configuration**: Works automatically for all actors

✅ **Error Isolation**: Failing effects don't block other effects (wrapped in try-catch)

✅ **Performance**: Minimizes event emissions and re-renders

✅ **Thread-Safe**: Each thread has its own isolated coordinator

### Implementation Details

#### ThreadContext Initialization

**Main Thread** (`ActorSystem.start()`):
```typescript
async start(): Promise<void> {
  const coordinator = new ThreadStateCoordinator();
  ThreadContext.initialize(coordinator);
  // ... instantiate actors
}
```

**Worker Thread** (`WorkerRuntime` constructor):
```typescript
constructor(workerBus, actorRegistry, actorMetadata) {
  const coordinator = new ThreadStateCoordinator();
  ThreadContext.initialize(coordinator);
}
```

#### Effect Error Isolation

**SyncActorClient** (main-thread effects):
```typescript
const callback = (payload: unknown) => {
  try {
    this.actorInstance.__invokeAction(methodName, [payload]);
  } catch (error) {
    console.error(`[SyncActorClient] Effect "${methodName}" failed:`, error);
  }
};
```

**WorkerRuntime** (worker-thread effects):
```typescript
(depClient as any).on(eventName, (payload: unknown) => {
  try {
    const actor = actorInstance as unknown as Record<string, unknown>;
    if (typeof actor[methodName] === 'function') {
      (actor[methodName] as (payload: unknown) => void)(payload);
    }
  } catch (error) {
    Logger.error(`[WorkerRuntime] Effect "${methodName}" failed:`, error);
  }
});
```

### Testing Support

The framework provides semantic test helpers for different event loop levels:

```typescript
// test-setup.ts
async function flushMicrotask(): Promise<void> {
  await Promise.resolve(); // Single microtask cycle
}

async function flushMacrotask(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0)); // Macrotask cycle
}

async function flushEffects(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0)); // BFS propagation
}
```

**Usage**:
- `flushMicrotask()`: Test single-actor state batching
- `flushEffects()`: Test cross-actor effect propagation
- `flushMacrotask()`: Test async message passing with timers

### Design Tradeoffs

**Chosen Approach**: Per-thread coordinator with two-phase flushing

**Alternatives Considered**:

1. **Immediate emission** (no batching):
   - ❌ Multiple emissions per setState call
   - ❌ No atomic visibility
   - ✅ Simpler implementation

2. **Per-actor batching only** (no coordinator):
   - ✅ Batches multiple setState calls within one actor
   - ❌ No atomic visibility across actors
   - ❌ Can't guarantee consistent snapshots

3. **Global coordinator** (not per-thread):
   - ❌ Violates thread isolation (workers don't share memory)
   - ❌ Would require complex synchronization

**Why two-phase flushing?**

Single-phase (apply + emit per actor) would allow observers to see:
- Actor A fully updated (state + events emitted)
- Actor B not yet updated (state not applied)

This creates **temporal inconsistency**. Two-phase ensures all state is updated before any events fire.

### References

- `src/core/ThreadContext.ts` - Thread-local service access
- `src/messaging/ThreadStateCoordinator.ts` - Batch coordinator
- `src/core/Actor.ts` - setState() implementation with two-phase split
- `src/test-setup.ts` - Test helpers (flushMicrotask, flushEffects, etc.)
- `src/core/atomic-updates.integration.test.ts` - Comprehensive integration tests

---

## Design Principles

### 1. Interface-Based Design

Use `IActorClient<TActor>` throughout the codebase instead of concrete types:

```typescript
// Good
private clients: Map<symbol, IActorClient<any>> = new Map();

// Bad
private clients: Map<symbol, ActorClient<any>> = new Map();
```

### 2. Design Before Implementation

The type system (`types.ts`) was defined before any client implementation. This ensures:
- Clear contracts
- No ad-hoc type definitions
- Minimal need for type assertions

### 3. Separation of Concerns

Each component has a single, well-defined responsibility:
- **Actor**: Manage state and emit events
- **SyncActorClient**: Synchronous access to main-thread actors
- **AsyncActorClient**: Asynchronous access to worker-thread actors
- **ActorSystem**: Coordinate actor instantiation and dependencies
- **Bus**: Cross-thread message passing

### 4. No Conditional Execution Context Checks

Avoid `if (threadId === MAIN_THREAD_ID)` checks in implementations. Instead:
- Use polymorphism (different client types)
- Use optional values (`bus?`)
- Use dual emission pattern

---

## Testing Strategy

### Unit Tests

- Test each client type independently
- Test dual emission in Actor
- Test effect setup in each client

### Integration Tests

- Test full actor system with main-thread actors
- Test full actor system with worker-thread actors
- Test mixed systems (main + worker actors)
- Test memory cleanup (subscribe/unsubscribe)

### Key Test Cases

1. **No bus creation for main-thread actors**:
   ```typescript
   const actorInstance = system.instances.get(token.symbol);
   expect(actorInstance.bus).toBeUndefined();
   ```

2. **Proper unsubscription**:
   ```typescript
   client.on('event', callback);
   client.off('event', callback);
   // Emit event - callback should not fire
   ```

3. **Direct state access (not cached)**:
   ```typescript
   const state1 = client.state;
   const state2 = client.state;
   expect(state1).toBe(state2); // Same reference
   ```

---

## Migration Guide

### From Old ActorClient to New Design

**Old code** (still works via backward compatibility):
```typescript
import { ActorClient } from '@d-buckner/ensemble-core';

const client: ActorClient<MyActor> = system.getClient(MyToken);
```

**New code** (recommended):
```typescript
import { IActorClient } from '@d-buckner/ensemble-core';

const client: IActorClient<MyActor> = system.getClient(MyToken);
```

### Accessing Specific Client Types

If you need to access client-specific methods:

```typescript
import { isAsyncActorClient } from '@d-buckner/ensemble-core';

const client = system.getClient(MyToken);

if (isAsyncActorClient(client)) {
  // AsyncActorClient-specific methods
  client.hydrateState(newState);
}
```

---

## Performance Considerations

### Main-Thread Actors (SyncActorClient)

**Advantages**:
- Zero serialization overhead
- Direct memory access
- No message queue delay
- Lower memory footprint (no bus, no state cache)

**Trade-offs**:
- Blocks main thread during execution
- Not suitable for heavy computation

### Worker-Thread Actors (AsyncActorClient)

**Advantages**:
- Non-blocking main thread
- Parallel execution
- Suitable for heavy computation

**Trade-offs**:
- Serialization overhead (msgpack)
- Message queue latency
- Higher memory footprint (bus + state cache)
- No shared memory access

### When to Use Each

**Use Main-Thread** (SyncActorClient) for:
- UI state management
- Fast, frequent updates
- Coordination logic
- Actors with many dependencies

**Use Worker-Thread** (AsyncActorClient) for:
- Heavy computation
- Data processing
- Background tasks
- Actors that rarely communicate

---

## Future Considerations

### Potential Enhancements

1. **Shared Worker Support**: Extend dual emission to support SharedWorker
2. **Remote Actors**: Extend to support actors on remote servers (WebSocket)
3. **Actor Migration**: Move actors between threads at runtime
4. **State Snapshots**: Serialize actor state for persistence

### Maintaining the Architecture

When adding features, preserve these principles:
- Keep dual emission pattern
- Maintain interface-based design
- Avoid execution context conditionals in implementations
- Each client type owns its behavior
- Types defined before implementation

---

## References

### Core Types & Base Classes
- `src/core/types.ts` - Type definitions
- `src/core/Actor.ts` - Base actor class with dual emission and state batching
- `src/core/ActorSystem.ts` - Actor instantiation and coordination

### Client Implementations
- `src/core/SyncActorClient.ts` - Main-thread client
- `src/core/ActorClient.ts` - Worker-thread client (AsyncActorClient)

### State Coordination
- `src/core/ThreadContext.ts` - Thread-local service access
- `src/messaging/ThreadStateCoordinator.ts` - Cross-actor state batching

### Testing
- `src/integration.test.ts` - End-to-end tests demonstrating both client types
- `src/core/atomic-updates.integration.test.ts` - Atomic visibility and batching tests
- `src/test-setup.ts` - Test helpers (flushMicrotask, flushEffects, etc.)
