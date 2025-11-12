# @d-buckner/ensemble-solidjs

SolidJS bindings for the Ensemble actor model framework.

## Features

- **createActor Primitive**: Reactive SolidJS integration with actors
- **Full Type Safety**: TypeScript support with type inference
- **Fine-Grained Reactivity**: Leverages SolidJS signals for optimal performance
- **Automatic Updates**: Components update when actor state changes

## Installation

```bash
npm install @d-buckner/ensemble-core @d-buckner/ensemble-solidjs solid-js
```

## Quick Start

```typescript
import { Actor, action, createActorToken, ActorSystem } from '@d-buckner/ensemble-core';
import { ActorSystemProvider, createActor } from '@d-buckner/ensemble-solidjs';

// 1. Define your actor
interface CounterState {
  count: number;
}

interface CounterActions {
  increment(): void;
}

interface CounterEvents {}

class CounterActor extends Actor<CounterState, CounterActions, CounterEvents> {
  static readonly initialState: CounterState = { count: 0 };

  @action
  increment(): void {
    this.setState(draft => { draft.count++; });
  }
}

const CounterToken = createActorToken<CounterActor>('counter');

// 2. Set up the actor system
const system = new ActorSystem();
system.register({ token: CounterToken, actor: CounterActor });
await system.start();

// 3. Provide the system to your SolidJS app
function App() {
  return (
    <ActorSystemProvider system={system}>
      <Counter />
    </ActorSystemProvider>
  );
}

// 4. Use the actor in components
function Counter() {
  const actor = createActor(CounterToken);

  return (
    <div>
      <p>Count: {actor.state.count}</p>
      <button onClick={() => actor.actions.increment()}>Increment</button>
    </div>
  );
}
```

## API

### `ActorSystemProvider`

Provides the actor system to child components.

```typescript
<ActorSystemProvider system={system}>
  {/* Your app */}
</ActorSystemProvider>
```

### `createActor(token)`

Reactive primitive to access actor state and actions.

```typescript
const actor = createActor(CounterToken);
// Access state: actor.state.count
// Call actions: actor.actions.increment()
```

## Documentation

For comprehensive documentation, visit the [Ensemble GitHub repository](https://github.com/d-buckner/ensemble).

## License

Apache-2.0 © Daniel Buckner
