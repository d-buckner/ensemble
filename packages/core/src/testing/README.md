# Ensemble Core Testing Utilities

Shared testing utilities for `@d-buckner/ensemble-core` to reduce duplication and improve test readability.

## Usage

```typescript
import { MockBus, CounterActor, setupActorWithBus } from '../testing';
```

## Mocks

### MockBus

In-memory implementation of `IActorBus` for testing without cross-thread complexity.

```typescript
const bus = new MockBus<AllEvents<MyState, MyEvents>>();

// Standard bus methods
bus.on('count', callback);
bus.emit('count', 42);
bus.off('count', callback);

// Test helpers
bus.hasListeners('count');        // Check if event has listeners
bus.getListenerCount('count');    // Get listener count
bus.clear();                      // Remove all listeners
```

## Fixtures

### CounterActor

Simple counter with basic actions for testing state management.

```typescript
const actor = new CounterActor(0);
actor.increment();  // count: 0 → 1
actor.decrement();  // count: 1 → 0
actor.setName('test');
actor.reset();      // Reset to initial state
```

### CollectionActor

Actor with nested state (array of items) for testing complex state updates.

```typescript
const actor = new CollectionActor();
actor.addItem('id-1', 100);
actor.updateItem('id-1', 200);
actor.removeItem('id-1');
actor.setFilter('active');
```

### ErrorProneActor

Actor that intentionally throws errors for testing error handling.

```typescript
const actor = new ErrorProneActor();
actor.throwError();      // Emits error event via this.throw()
actor.throwInAction();   // Throws uncaught error in action
actor.safeAction();      // Normal action that succeeds
```

## Helpers

### setupActorWithBus

Quickly set up an actor with MockBus and metadata.

```typescript
const { actor, bus, metadata } = setupActorWithBus(
  new CounterActor(),
  { id: 'my-counter', threadId: 'worker-1' }
);

// Actor is already initialized and ready to use
bus.emit('increment', []);
```

### createHydratedClient

Create an ActorClient with state already hydrated (for testing without delays).

```typescript
const { client, bus } = createHydratedClient(
  CounterActor,
  { count: 5, name: 'test' }
);

// Client is ready with state already available
expect(client.state.count).toBe(5);
```

### waitForEvent

Wait for an event to be emitted (useful for async tests).

```typescript
const promise = waitForEvent<number>(bus, 'count');
bus.emit('count', 42);
const value = await promise;  // value === 42
```

## Benefits

✅ **No duplication** - MockBus defined once, used everywhere
✅ **Consistent patterns** - All tests use the same setup helpers
✅ **Better readability** - Less boilerplate in test files
✅ **Easier maintenance** - Changes to test utilities in one place
✅ **Type-safe** - Full TypeScript support with generics
