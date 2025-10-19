# Ensemble

[![npm version](https://img.shields.io/npm/v/@d-buckner/ensemble-core.svg)](https://www.npmjs.com/package/@d-buckner/ensemble-core)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Overview

Ensemble is a frontend framework for building complex applications using the actor model. It enables developers to organize application logic into independent, composable actors that communicate via message passing. Actors can run on any thread (main or a worker) without coupling the actor topology to execution context, allowing for flexible performance optimization and clear separation of concerns.

## Table of Contents

- [Overview](#overview)
- [Project Status](#project-status)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Packages](#packages)
- [The Challenge](#the-challenge)
- [Core Architecture](#core-architecture)
  - [Actors and the Actor System](#actors-and-the-actor-system)
  - [ActorClients: The Developer Interface](#actorclients-the-developer-interface)
  - [Actor System: Lifecycle and Dependency Management](#actor-system-lifecycle-and-dependency-management)
- [How It Works: The Actor Model](#how-it-works-the-actor-model)
  - [Mental Model](#mental-model)
  - [The Routing Pattern](#the-routing-pattern)
  - [Why Centralized Routing?](#why-centralized-routing)
- [Real-Time Collaboration](#real-time-collaboration)
- [Key Design Principles](#key-design-principles)
- [Examples & Demos](#examples--demos)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

**Who is this for?**

Ensemble is an experiment framework for folks who have run into compositional/multi-threading challenges with traditional frameworks and tools. If you're building a typical CRUD app or small-to-medium application, established patterns and tools likely serve you better. This framework is designed for teams working on large-scale or innovative frontends where maintaining development velocity as complexity grows becomes a primary concern.

**Status:** ⚠️ Experimental - APIs may change

Ensemble is a new framework actively being developed. While the core concepts are solid and the implementation is functional, you should expect:
- API changes between minor versions
- Ongoing performance optimization
- Expanding documentation and examples

Not recommended for production use yet, but perfect for experimentation and feedback.

## Installation

```bash
# Core framework
npm install @d-buckner/ensemble-core

# React bindings
npm install @d-buckner/ensemble-react

# SolidJS bindings
npm install @d-buckner/ensemble-solidjs

# Vite plugin (for multi-threading support)
npm install -D @d-buckner/ensemble-vite-plugin

# Collaboration (real-time CRDT sync)
npm install @d-buckner/ensemble-collaboration
```

## Quick Start

```typescript
import { createActorToken, ActorSystem, Actor, action } from '@d-buckner/ensemble-core';

// 1. Define an actor
class CounterActor extends Actor {
  state = { count: 0 };

  @action
  increment(): void {
    this.setState({ count: this.state.count + 1 });
  }
}

// 2. Create a token and system
const CounterToken = createActorToken<CounterActor>('counter');
const system = new ActorSystem();

system.register({ token: CounterToken, actor: CounterActor });
await system.start();

// 3. Use the actor
const counter = system.get(CounterToken);
counter.on('stateChanged', (state) => console.log(state));
counter.actions.increment(); // { count: 1 }
```

**With React:**

```typescript
import { useActor } from '@d-buckner/ensemble-react';

function Counter() {
  const { state, actions } = useActor(CounterToken);
  return (
    <button onClick={actions.increment}>
      Count: {state.count}
    </button>
  );
}
```

## Packages

Ensemble is a monorepo with multiple packages:

| Package | Description |
|---------|-------------|
| [@d-buckner/ensemble-core](./packages/core) | Core actor framework with threading support |
| [@d-buckner/ensemble-react](./packages/react) | React hooks and bindings |
| [@d-buckner/ensemble-solidjs](./packages/solidjs) | SolidJS primitives and bindings |
| [@d-buckner/ensemble-vite-plugin](./packages/vite-plugin) | Vite plugin for Web Worker threading |
| [@d-buckner/ensemble-collaboration](./packages/collaboration) | Real-time collaboration with Automerge CRDTs |

## The Challenge
For large-scale and innovative frontends, some fundamental architectural challenges can impact developer velocity:

**State Ownership**

Without clear ownership boundaries, there's no place to enforce business rules. State can be modified from multiple places, so you can't guarantee invariants hold. Business logic either gets duplicated across consumers (every component checks the same rules) or bypassed entirely (some code path forgets to validate). The logic and the state it manages become separated, breaking encapsulation.

**State Derivation**

Deriving state from multiple sources is common but often awkward. Selectors help but don't solve cross-cutting concerns. When you need to compute state based on multiple independent pieces of data, the patterns available don't always provide a clean way to express those dependencies.

**Singleton Everything**

When your state management is built around singletons, composition becomes difficult. You can't easily instantiate multiple instances of the same logic with different configurations. Features can't cleanly depend on each other without coupling to a global instance.

**Logic Placement**

Business logic needs a home. When it lives in UI components, testing and reasoning about it independently becomes harder. When it's scattered across action creators, reducers, and selectors, following the flow of logic requires jumping between multiple abstractions.

Ensemble provides an actor model architecture where each actor has strict state ownership, can declare dependencies on other actors, and derives its own state through effects. Actors are composable units, not singletons. You can have multiple instances, and features can depend on each other through explicit dependency injection.

**Multi-threading as a natural consequence**

Because actors communicate through message passing with clear boundaries, they can run anywhere. Moving an actor to a worker thread is a configuration change, not an architectural overhaul. The patterns that enable clean composition also make performance optimization straightforward.

## Core Architecture

### Actors and the Actor System

Actors are the fundamental building blocks of a Ensemble application. Each actor is an independent unit that can have its own state and emit events. Actors can depend on other actors, creating an **actor system** that defines the relationships between different parts of your application.

The key insight is that while actors may depend on each other logically, they're not bound to the same execution context. An actor running in a worker thread can depend on an actor in the main thread, or vice versa. This separation allows you to optimize performance without restructuring your application logic.

### ActorClients: The Developer Interface

When you need to interact with an actor, you don't get direct access to the actor implementation. This is especially important when actors run in different execution contexts. Instead, you work with an **ActorClient**, a strongly typed proxy that knows how to communicate with the actor regardless of where it's running.

An ActorClient gives you three main capabilities:

1. **Subscribe to events**: `on(eventName, callback)`, `off(eventName, callback)`, and `once(eventName, callback)` let you listen to events from the actor

2. **Read state**: The `state` attribute provides what feels like direct access to the current actor state. Under the hood, the ActorClient maintains a **local cache** of state that's updated through state event messages. When you read `actorClient.state.items`, you're reading from this cache, not directly from the actor instance. This preserves the actor model (all updates flow through messages) while providing ergonomic, synchronous access.

3. **Trigger actions**: The `actions` attribute lets you call action methods on the actor. These calls are converted to messages and sent to the actor.

This is where the actor model really shines for developer experience. From a developer's perspective, using an ActorClient feels just as natural as working with a local object. You can read state, subscribe to events, and trigger actions. But under the hood, **all of this happens through message passing**. The ActorClient's restricted API ensures you can't break out of the actor model (no direct access to the actor instance, no shared references) or create tight coupling between execution contexts.

### Actor System: Lifecycle and Dependency Management

The ActorSystem is responsible for managing the lifecycle of actors and resolving dependencies. Like traditional DI containers (Angular, InversifyJS, Spring), it provides a registry where actors are defined and a resolution mechanism for injecting dependencies.

#### What Makes Ensemble's ActorSystem Different

Traditional DI containers operate within a single execution context. Ensemble's ActorSystem must coordinate across multiple threads while maintaining the dependency graph. The system consists of:

1. **Registration Phase**: Define actors and their dependencies
2. **Topology Configuration**: Specify which actors run on which threads
3. **Resolution Phase**: Instantiate actors and inject ActorClients for dependencies
4. **Lifecycle Management**: Handle actor initialization, updates, and cleanup

#### Key Responsibilities

**Dependency Resolution Across Threads**
When an actor declares a dependency on another actor, the system doesn't inject the actor instance directly. Instead, it injects an ActorClient that can communicate with the actor regardless of thread boundaries.

**Thread Topology Management**
The ActorSystem knows the complete actor topology and thread assignment. This knowledge powers the centralized routing system, ensuring messages flow correctly between actors on different threads.

**Actor Lifecycle**
The ActorSystem manages the full lifecycle of actors:
- **Instantiation**: Create actor instances with their dependencies
- **Initialization**: Run any startup logic or effects
- **Updates**: Coordinate state changes and event propagation
- **Cleanup**: Properly dispose of actors and their subscriptions

**Actor Scopes**
Like traditional DI systems, the ActorSystem supports different actor lifetimes:
- **Singleton**: Single instance shared across the application (most common for actors)
- **Scoped**: Instance per context (useful for worker-specific actors)
- **Transient**: New instance per injection (rare, for stateless utilities)

## How It Works: The Actor Model

### Mental Model

Ensemble implements the **actor model**, a proven pattern from distributed systems like Erlang, Elixir, and Akka. Each actor is an isolated unit with its own state that communicates exclusively through message passing.

**Key actor model principles in Ensemble:**
- **Isolation**: Actors cannot access other actors' state directly. All inter-actor communication is through message passing
- **Message passing**: All communication happens through messages
- **Location transparency**: Actors communicate the same way regardless of where they're running
- **No shared mutable state**: Each actor owns its state completely. Other actors receive state updates as messages, not direct references

Think of it like a postal system with a central sorting facility. When an actor wants to communicate with its dependencies (or when dependencies want to notify the actor of changes), it sends a message. If both actors happen to be on the same thread, that message is delivered directly, like handing a letter to your neighbor. But if the recipient actor is on a different thread, the message needs to travel through the central sorting facility (the main thread) which knows the full map of where every actor lives and can route accordingly.

This design solves a fundamental challenge: how do you let actors communicate across thread boundaries without each thread needing to know the entire topology of your application?

### The Routing Pattern

Actors communicate through **message passing**, inspired by the [Beam VM's implementation of the actor model](https://blog.stenmans.org/theBeamBook/#_mailboxes_and_message_passing). An actor doesn't need to know whether its dependency is on the same thread or a different one. The message routing system handles that complexity.

The main thread acts as the source of truth for the actor system. It knows which actors exist, where they're running, and how they're connected. This centralized knowledge allows it to intelligently route messages:

1. **For actors on the main thread**: Messages are routed directly to their destination
2. **For actors on worker threads**: Messages are posted to the appropriate worker, along with the target actor ID

Each thread (main or worker) has exactly one **ThreadBus** instance responsible for message routing within that thread's context.

### Why Centralized Routing?

By centralizing the actor system knowledge on the main thread, worker threads can remain lightweight. They don't need to understand the entire application topology. Instead, they receive targeted messages with actor IDs and simply route to their local actors. This keeps the system scalable even as your actor system grows.

## Real-Time Collaboration

The `@d-buckner/ensemble-collaboration` package provides CRDT-based collaboration using Automerge:

- 🔄 **Automatic conflict resolution** - Automerge CRDTs handle concurrent edits
- 🌐 **WebRTC-first with WebSocket fallback** - Low-latency P2P with reliable fallback
- 🎭 **Actor-based architecture** - Four specialized actors (Collaboration, PeerMessaging, WebSocket, WebRTC)
- 📦 **Type-safe** - Generic document types with full TypeScript support
- 🔌 **Framework agnostic** - Works with any transport layer

```typescript
import { CollaborationActor } from '@d-buckner/ensemble-collaboration';

// Extend CollaborationActor with domain-specific actions
class TodosActor extends CollaborationActor<TodoDoc> {
  static readonly initialState: TodoDoc = { todos: [] };

  constructor() {
    super(TodosActor.initialState);
  }

  @action
  addTodo(text: string): void {
    this.setState(draft => {
      draft.todos.push({
        id: `todo-${Date.now()}`,
        text,
        done: false
      });
    });
    // Automatically synced with all connected peers!
  }

  @action
  toggleTodo(id: string): void {
    this.setState(draft => {
      const todo = draft.todos.find(t => t.id === id);
      if (todo) todo.done = !todo.done;
    });
  }
}
```

The CRDT document **is** the actor state directly - no wrapper objects. Changes sync automatically through effects, and the actor handles transport abstraction so your code stays clean and focused on business logic.

See the [collaboration package README](./packages/collaboration/README.md) for complete setup instructions and server configuration.

## Key Design Principles

1. **Separation of concerns**: Logical actor dependencies are separate from execution context
2. **Developer ergonomics**: ActorClients provide a familiar, synchronous-feeling interface while maintaining message passing underneath. State reads are from message-updated caches, preserving actor isolation.
3. **Scalability**: Centralized routing keeps workers lightweight and focused
4. **Type safety**: Strong typing throughout the message passing system
5. **Consistency**: State updates are events, keeping the API uniform

## Examples & Demos

Working examples are available in the `demos/` directory:

**React:**
- [Counter](./demos/react/counter) - Basic actor with React hooks
- [Collaboration](./demos/react/collaboration) - Real-time collaborative todo list with CRDT sync

**SolidJS:**
- [Counter](./demos/solidjs/counter) - Basic actor with SolidJS primitives
- [Metrics Dashboard](./demos/solidjs/metrics-dashboard) - Performance monitoring dashboard

```bash
# Run a demo
npm run demo:react:counter
npm run demo:solidjs:metrics-dashboard
```

## Documentation

- **[Core Package](./packages/core/README.md)** - Actor, ActorClient, ActorSystem API
- **[React Bindings](./packages/react/README.md)** - useActor, useActorState hooks
- **[SolidJS Bindings](./packages/solidjs/README.md)** - createActor, createActorState primitives
- **[Vite Plugin](./packages/vite-plugin/README.md)** - Multi-threading configuration
- **[Collaboration](./packages/collaboration/README.md)** - CRDT collaboration setup
- **[Performance Guide](./PERFORMANCE.md)** - Optimization strategies and trade-offs
- **[Design Documents](./designs/README.md)** - Architecture deep-dives

## Contributing

Ensemble is in active development and welcomes contributions!

- **Issues**: [GitHub Issues](https://github.com/d-buckner/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/d-buckner/ensemble/discussions)

## License

[Apache 2.0](./LICENSE)
