# @d-buckner/ensemble-core

Type-safe actor model framework for predictable state management in TypeScript applications.

## Features

- **Actor Model**: Isolated state management with clear boundaries
- **TypeScript First**: Full type safety with decorators and generics
- **Effect System**: Reactive communication between actors
- **Dependency Injection**: Type-safe actor dependencies
- **Threading**: Run actors in Web Workers for true parallelism
- **Immutable Updates**: Built on Mutative for performant immutable state

## Installation

```bash
npm install @d-buckner/ensemble-core
```

## Quick Start

```typescript
import { Actor, action, createActorToken, ActorSystem } from '@d-buckner/ensemble-core';

// 1. Define your actor state, actions, and events
interface CounterState {
  count: number;
}

interface CounterActions {
  increment(): void;
  decrement(): void;
}

interface CounterEvents {
  incremented: number;
}

// 2. Create an actor class
class CounterActor extends Actor<CounterState, CounterActions, CounterEvents> {
  static readonly initialState: CounterState = { count: 0 };

  @action
  increment(): void {
    this.setState(draft => {
      draft.count++;
    });
    this.emit('incremented', this.state.count);
  }

  @action
  decrement(): void {
    this.setState(draft => {
      draft.count--;
    });
  }
}

// 3. Register and use the actor
const CounterToken = createActorToken<CounterActor>('counter');
const system = new ActorSystem();

system.register({ token: CounterToken, actor: CounterActor });
await system.start();

const counter = system.get(CounterToken);
counter.actions.increment();
console.log(counter.state.count); // 1
```

## Documentation

For comprehensive documentation, visit the [Ensemble GitHub repository](https://github.com/d-buckner/ensemble).

## License

Apache-2.0 © Daniel Buckner
