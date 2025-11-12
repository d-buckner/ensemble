# @d-buckner/ensemble-react

React bindings for the Ensemble actor model framework.

## Features

- **useActor Hook**: Subscribe to actor state and access actions
- **Full Type Safety**: TypeScript support with type inference
- **Automatic Re-renders**: Components update when actor state changes
- **Optimized**: Fine-grained reactivity prevents unnecessary renders

## Installation

```bash
npm install @d-buckner/ensemble-core @d-buckner/ensemble-react react
```

## Quick Start

```typescript
import { Actor, action, createActorToken, ActorSystem } from '@d-buckner/ensemble-core';
import { ActorSystemProvider, useActor } from '@d-buckner/ensemble-react';

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

// 3. Provide the system to your React app
function App() {
  return (
    <ActorSystemProvider system={system}>
      <Counter />
    </ActorSystemProvider>
  );
}

// 4. Use the actor in components
function Counter() {
  const { state, actions } = useActor(CounterToken);

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => actions.increment()}>Increment</button>
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

### `useActor(token)`

Hook to access actor state and actions.

```typescript
const { state, actions } = useActor(CounterToken);
```

## Documentation

For comprehensive documentation, visit the [Ensemble GitHub repository](https://github.com/d-buckner/ensemble).

## License

Apache-2.0 © Daniel Buckner
