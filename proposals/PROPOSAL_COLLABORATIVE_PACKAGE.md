# Collaborative CRDT Package: Design Proposal

## Overview

This proposal introduces `@d-buckner/ensemble-collaborative`, a package providing collaborative editing capabilities through Conflict-Free Replicated Data Types (CRDTs) using Automerge.

**Core components:**
- **PeerActor** - Manages peer connections, message routing, and broadcasting
- **CollaborativeActor<TDoc>** - Generic CRDT document manager where TDoc IS the actor state

**Key principle:** The CRDT document is the actor's state directly. No wrapper objects, no metadata pollution. All mutations go through `setState()`, which is internally backed by Automerge for automatic conflict resolution.

## Motivation

### Use Cases

1. **Real-time collaboration** - Multiple users editing the same document simultaneously
2. **Offline-first applications** - Users can edit offline, sync automatically when reconnected
3. **Distributed state** - State synchronized across multiple clients without central server coordination
4. **Conflict-free merging** - Automatic conflict resolution for concurrent edits

### Why Separate Package?

- **Optional dependency** - Not all apps need collaboration
- **Bundle size** - Automerge (~27KB gzipped) only included when needed
- **Clear boundaries** - Collaboration concerns separated from core actor framework
- **Extensibility** - Users can build custom transport layers (WebSocket, WebRTC, etc.)

### Why CRDT?

CRDTs provide **strong eventual consistency**: all peers converge to the same state regardless of network delays, disconnections, or concurrent edits. This enables true offline-first applications with guaranteed conflict resolution.

## Architecture

### Two-Actor Design

```
PeerActor (manages networking)
     ↓ (dependency via @effect)
CollaborativeActor<TDoc> (manages CRDT document)
```

**Separation of concerns:**
- **PeerActor**: Peer lifecycle, message routing, broadcast - knows nothing about CRDTs
- **CollaborativeActor**: CRDT operations, conflict resolution - knows nothing about networking

### Why Two Actors?

1. **Single Responsibility** - PeerActor handles *who* to talk to, CollaborativeActor handles *what* to say
2. **Reusability** - PeerActor can be extended for different transports (WebSocket, WebRTC, etc.)
3. **Testability** - Can test CRDT logic independently from networking
4. **Actor Model Purity** - Each actor has clear state ownership and event boundaries

## Component Design

### 1. PeerActor

**Responsibility:** Complete peer management abstraction

```typescript
interface PeerState {
  peerId: string;
  connectedPeers: string[];
}

interface PeerEvents {
  sendMessage: { peerId: string; message: Uint8Array };
  messageReceived: { peerId: string; message: Uint8Array };
  peerConnected: string;
  peerDisconnected: string;
}

class PeerActor extends Actor<PeerState, PeerEvents> {
  static readonly initialState: PeerState = {
    peerId: '',
    connectedPeers: []
  };

  constructor(config: { peerId: string }) {
    super({
      ...PeerActor.initialState,
      peerId: config.peerId
    });
  }

  @action
  connectPeer(peerId: string): void {
    this.setState(draft => {
      if (!draft.connectedPeers.includes(peerId)) {
        draft.connectedPeers.push(peerId);
      }
    });
    this.emit('peerConnected', peerId);
  }

  @action
  disconnectPeer(peerId: string): void {
    this.setState(draft => {
      draft.connectedPeers = draft.connectedPeers.filter(p => p !== peerId);
    });
    this.emit('peerDisconnected', peerId);
  }

  @action
  receiveMessage(peerId: string, message: Uint8Array): void {
    this.emit('messageReceived', { peerId, message });
  }

  @action
  sendTo(peerId: string, message: Uint8Array): void {
    this.emit('sendMessage', { peerId, message });
  }

  @action
  broadcast(message: Uint8Array): void {
    for (const peerId of this.state.connectedPeers) {
      this.emit('sendMessage', { peerId, message });
    }
  }
}
```

**Key features:**
- **Transport-agnostic** - Emits `sendMessage` events, doesn't care about WebSocket/WebRTC
- **Broadcast support** - Send to all connected peers with single action
- **Peer lifecycle** - Tracks connection/disconnection for sync initialization/cleanup

### 2. CollaborativeActor

**Responsibility:** Pure CRDT document management

**Core innovation:** TDoc IS the state. No wrapper, no metadata.

```typescript
interface CollaborativeEvents {
  // Internal: route sync messages via PeerActor
  sendSyncMessage: { peerId: string; message: Uint8Array };
}

interface CollaborativeDeps {
  peer: IActorClient<PeerActor>;
}

class CollaborativeActor<TDoc> extends Actor<TDoc, CollaborativeEvents> {
  // Automerge internals (private, NOT in state)
  private automergeDoc: AutomergeDoc<TDoc>;
  private syncStates = new Map<string, SyncState>();

  protected declare deps: CollaborativeDeps;

  constructor(initialDocument: TDoc) {
    super(initialDocument);
    this.automergeDoc = Automerge.from(initialDocument);
  }

  // Override setState to route through Automerge CRDT
  protected setState(updater: (draft: Draft<TDoc>) => void): void {
    // 1. Apply via Automerge (conflict resolution)
    const newDoc = Automerge.change(this.automergeDoc, updater);
    const changes = Automerge.getChanges(this.automergeDoc, newDoc);
    this.automergeDoc = newDoc;

    // 2. Update actor state via parent (triggers state events)
    super.setState(draft => {
      Object.assign(draft, Automerge.toJS(newDoc));
    });

    // 3. Generate sync messages for peers
    if (changes.length > 0) {
      const peers = this.deps.peer.state.connectedPeers;
      for (const peerId of peers) {
        const syncMsg = this.generateSyncMessageForPeer(peerId);
        if (syncMsg) {
          this.emit('sendSyncMessage', { peerId, message: syncMsg });
        }
      }
    }
  }

  // ========================================
  // Effects: React to peer events
  // ========================================

  @effect('peer.messageReceived')
  private handleIncomingMessage({ peerId, message }: { peerId: string; message: Uint8Array }): void {
    const syncState = this.syncStates.get(peerId) || Automerge.initSyncState();

    const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
      this.automergeDoc,
      syncState,
      message
    );

    this.syncStates.set(peerId, newSyncState);

    // Document changed - update via parent setState (skip sync broadcast)
    if (newDoc !== this.automergeDoc) {
      this.automergeDoc = newDoc;
      super.setState(draft => {
        Object.assign(draft, Automerge.toJS(newDoc));
      });
    }

    // Generate response if needed
    const [nextSyncState, responseMsg] = Automerge.generateSyncMessage(
      this.automergeDoc,
      newSyncState
    );

    if (responseMsg) {
      this.syncStates.set(peerId, nextSyncState);
      this.emit('sendSyncMessage', { peerId, message: responseMsg });
    }
  }

  @effect('peer.peerConnected')
  private initSyncWithPeer(peerId: string): void {
    const syncState = Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );

    if (message) {
      this.syncStates.set(peerId, newSyncState);
      this.emit('sendSyncMessage', { peerId, message });
    }
  }

  @effect('peer.peerDisconnected')
  private cleanupPeer(peerId: string): void {
    this.syncStates.delete(peerId);
  }

  // Forward sync messages to PeerActor
  @effect('this.sendSyncMessage')
  private forwardToPeer({ peerId, message }: { peerId: string; message: Uint8Array }): void {
    this.deps.peer.actions.sendTo(peerId, message);
  }

  // ========================================
  // Private helpers
  // ========================================

  private generateSyncMessageForPeer(peerId: string): Uint8Array | null {
    const syncState = this.syncStates.get(peerId) || Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );
    if (message) {
      this.syncStates.set(peerId, newSyncState);
    }
    return message;
  }
}
```

**Key features:**
- **setState override** - All mutations route through Automerge for CRDT resolution
- **Effect-driven sync** - No public `receiveSyncMessage()` method - all via effects
- **Zero networking knowledge** - Never touches peer lists or routing
- **Clean state** - Metadata (automergeDoc, syncStates) kept private, not in state

## Usage Patterns

### Basic Setup

Users extend CollaborativeActor and add domain-specific actions:

```typescript
import { CollaborativeActor, PeerActor } from '@d-buckner/ensemble-collaborative';
import { createActorToken, ActorSystem, action } from '@d-buckner/ensemble-core';

// 1. Define document type
interface TodoDoc {
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// 2. Extend CollaborativeActor with domain actions
class TodosActor extends CollaborativeActor<TodoDoc> {
  static readonly initialState: TodoDoc = {
    todos: []
  };

  constructor() {
    super(TodosActor.initialState);
  }

  @action
  addTodo(text: string): void {
    // Uses overridden setState - goes through Automerge
    this.setState(draft => {
      draft.todos.push({
        id: `todo-${Date.now()}`,
        text,
        done: false
      });
    });
  }

  @action
  toggleTodo(id: string): void {
    this.setState(draft => {
      const todo = draft.todos.find(t => t.id === id);
      if (todo) {
        todo.done = !todo.done;
      }
    });
  }

  @action
  removeTodo(id: string): void {
    this.setState(draft => {
      draft.todos = draft.todos.filter(t => t.id !== id);
    });
  }
}

// 3. Register actors with dependency
const PeerToken = createActorToken<PeerActor>('peer');
const TodosToken = createActorToken<TodosActor>('todos');

const system = new ActorSystem();

system.register({
  token: PeerToken,
  actor: PeerActor
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: {
    peer: PeerToken  // CollaborativeActor depends on PeerActor
  }
});

await system.start();
```

### UI Integration (React)

```typescript
function TodoList() {
  const { state, actions } = useActor(TodosToken);

  // state is TodoDoc directly - no wrapper!
  return (
    <div>
      <h1>Collaborative Todos</h1>
      {state.todos.map(todo => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.done}
            onChange={() => actions.toggleTodo(todo.id)}
          />
          {todo.text}
          <button onClick={() => actions.removeTodo(todo.id)}>×</button>
        </div>
      ))}
      <button onClick={() => actions.addTodo('New task')}>
        Add Todo
      </button>
    </div>
  );
}
```

### Network Integration (Transport Layer)

**Option 1: External WebSocket (recommended)**

```typescript
const peerClient = system.getClient(PeerToken);

// Outbound: PeerActor tells us to send
peerClient.on('sendMessage', ({ peerId, message }) => {
  webSocket.send(JSON.stringify({ to: peerId, data: Array.from(message) }));
});

// Inbound: WebSocket receives, forwards to PeerActor
webSocket.on('message', (event) => {
  const { from, data } = JSON.parse(event.data);
  peerClient.actions.receiveMessage(from, new Uint8Array(data));
});

webSocket.on('peer-connected', (peerId) => {
  peerClient.actions.connectPeer(peerId);
});

webSocket.on('peer-disconnected', (peerId) => {
  peerClient.actions.disconnectPeer(peerId);
});
```

**Option 2: WebSocketPeerActor (extends PeerActor)**

Users can extend PeerActor to encapsulate transport:

```typescript
class WebSocketPeerActor extends PeerActor {
  private socket?: WebSocket;

  @action
  connect(url: string): void {
    this.socket = new WebSocket(url);

    this.socket.onmessage = (event) => {
      const { peerId, message } = JSON.parse(event.data);
      this.receiveMessage(peerId, new Uint8Array(message));
    };

    this.socket.onclose = () => {
      // Disconnect all peers
      for (const peerId of this.state.connectedPeers) {
        this.disconnectPeer(peerId);
      }
    };
  }

  // Override to actually send via WebSocket
  @action
  sendTo(peerId: string, message: Uint8Array): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        to: peerId,
        data: Array.from(message)
      }));
    }
    super.sendTo(peerId, message); // Emit event for monitoring
  }
}
```

## Design Decisions

### 1. Document IS State (No Wrapper)

**Decision:** `Actor<TDoc, Events>` not `Actor<{ document: TDoc }, Events>`

**Rationale:**
- **Clean API**: `state.todos` instead of `state.document.todos`
- **Type simplicity**: No wrapper type to maintain
- **Direct access**: Consumers see pure domain model
- **Less noise**: No artificial nesting

**Alternative considered:** Wrapper object with metadata
- ❌ Would expose internal details (sync state, peer info) to consumers
- ❌ Would require consumers to unwrap for every access
- ✅ Keeping metadata private maintains clean separation

### 2. setState Override for CRDT

**Decision:** Override `setState()` to route through Automerge

**Rationale:**
- **Familiar API**: Users call `this.setState()` like any actor
- **Transparent CRDT**: Conflict resolution happens automatically
- **No new methods**: No need to learn `updateDocument()` or similar
- **Actor model purity**: State still flows through `setState()` → state events

**How it works:**
```typescript
protected setState(updater: (draft: Draft<TDoc>) => void): void {
  // 1. Automerge applies change (CRDT resolution)
  const newDoc = Automerge.change(this.automergeDoc, updater);

  // 2. Call parent setState (triggers state events)
  super.setState(draft => Object.assign(draft, Automerge.toJS(newDoc)));

  // 3. Generate sync messages
  // ...
}
```

**Alternative considered:** Separate `updateDocument()` method
- ❌ Would require users to choose between `setState()` and `updateDocument()`
- ❌ Would create confusion about which to use when
- ✅ Override keeps API consistent

### 3. Users Extend CollaborativeActor

**Decision:** CollaborativeActor is a base class, users extend it

**Rationale:**
- **Domain actions**: Users add `addTodo()`, `toggleTodo()`, etc.
- **Type safety**: `TodosActor extends CollaborativeActor<TodoDoc>`
- **Encapsulation**: Business logic lives with state definition
- **Familiar pattern**: Same as extending `Actor` in core framework

**Alternative considered:** Direct use of CollaborativeActor
- ❌ Would force all mutations through generic `setState()` from outside
- ❌ Would lose encapsulation of business logic
- ✅ Extension enables domain-specific APIs

### 4. Effects for Sync (Not Public Actions)

**Decision:** Sync handled via `@effect('peer.messageReceived')`, not public `receiveSyncMessage()` action

**Rationale:**
- **Actor model purity**: All inter-actor communication via effects
- **Clean API**: Only domain actions exposed (`addTodo`, not `receiveSyncMessage`)
- **Automatic wiring**: Effects set up by ActorSystem, no manual subscription
- **Separation of concerns**: Users interact with domain API, sync happens internally

**Effect chain:**
```
PeerActor.receiveMessage(peerId, msg)
  → emits 'messageReceived' event
    → CollaborativeActor @effect('peer.messageReceived')
      → applies Automerge changes
        → emits 'sendSyncMessage'
          → @effect('this.sendSyncMessage')
            → calls peer.actions.sendTo()
```

### 5. PeerActor for Networking Abstraction

**Decision:** Separate PeerActor handles all networking concerns

**Rationale:**
- **Single responsibility**: PeerActor = networking, CollaborativeActor = CRDT
- **Reusability**: WebSocketPeerActor, WebRTCPeerActor extend same base
- **Testability**: Can test CRDT logic without network mocking
- **Transport agnostic**: Swap WebSocket for WebRTC without touching CRDT code

**Alternative considered:** Networking in CollaborativeActor
- ❌ Would mix CRDT logic with transport concerns
- ❌ Would make transport swapping harder
- ✅ Separation enables clean extensions

## Implementation Details

### Automerge Integration

**Sync Protocol:**
1. **Peer connects** → `@effect('peer.peerConnected')` → send full state
2. **Local edit** → `setState()` override → generate changes → broadcast to peers
3. **Remote edit arrives** → `@effect('peer.messageReceived')` → merge via Automerge → update state
4. **Conflict resolution** → Automerge automatically merges concurrent changes

**Sync State Management:**
- Each peer has sync state (tracks what they've seen)
- Stored in `Map<peerId, SyncState>`
- Cleaned up on `@effect('peer.peerDisconnected')`

**Change Generation:**
```typescript
// On setState override:
const newDoc = Automerge.change(this.automergeDoc, updater);
const changes = Automerge.getChanges(this.automergeDoc, newDoc);

// For each peer:
const [syncState, message] = Automerge.generateSyncMessage(
  this.automergeDoc,
  peerSyncState
);
```

**Change Application:**
```typescript
// On messageReceived effect:
const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
  this.automergeDoc,
  peerSyncState,
  message
);
```

### Effect Chain

```
User action (e.g., addTodo)
  ↓
this.setState(draft => draft.todos.push(...))
  ↓
setState override intercepts
  ↓
Automerge.change() applies mutation
  ↓
super.setState() triggers state event
  ↓
Generate sync messages for each peer
  ↓
this.emit('sendSyncMessage', { peerId, message })
  ↓
@effect('this.sendSyncMessage') triggers
  ↓
this.deps.peer.actions.sendTo(peerId, message)
  ↓
PeerActor.sendTo() action
  ↓
PeerActor.emit('sendMessage', { peerId, message })
  ↓
Transport layer sends to network
```

### Private State Management

**Public state (TDoc):**
```typescript
state.todos // Direct access to document
```

**Private metadata:**
```typescript
private automergeDoc: AutomergeDoc<TDoc>;  // CRDT internals
private syncStates: Map<string, SyncState>; // Per-peer sync state
```

**Rationale:** Keeps public API clean while maintaining CRDT machinery internally.

## Testing Strategy

### Unit Tests

**PeerActor:**
- ✅ Peer connection/disconnection updates state
- ✅ `sendTo()` emits `sendMessage` event
- ✅ `broadcast()` emits for all connected peers
- ✅ `receiveMessage()` emits `messageReceived` event

**CollaborativeActor:**
- ✅ `setState()` routes through Automerge
- ✅ Local changes generate sync messages
- ✅ Remote changes update state
- ✅ Concurrent edits merge correctly
- ✅ Sync state initialized on peer connect
- ✅ Sync state cleaned up on peer disconnect

### Integration Tests

**Two-peer scenario:**
```typescript
// Setup two actor systems with TodosActor
const system1 = createSystem('peer-1');
const system2 = createSystem('peer-2');

// Connect peers
peer1.actions.connectPeer('peer-2');
peer2.actions.connectPeer('peer-1');

// Peer 1 adds todo
todos1.actions.addTodo('Task 1');

// Forward sync messages
peer1.on('sendMessage', ({ peerId, message }) => {
  peer2.actions.receiveMessage('peer-1', message);
});

// Verify peer 2 sees update
await waitFor(() => {
  expect(todos2.state.todos).toHaveLength(1);
  expect(todos2.state.todos[0].text).toBe('Task 1');
});
```

**Concurrent edits:**
```typescript
// Both peers add different todos
todos1.actions.addTodo('Task A');
todos2.actions.addTodo('Task B');

// Sync messages
exchangeMessages(peer1, peer2);

// Both should have both todos (CRDT merge)
expect(todos1.state.todos).toHaveLength(2);
expect(todos2.state.todos).toHaveLength(2);
```

## Package Structure

```
packages/collaborative/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Public exports
│   ├── PeerActor.ts          # Peer management
│   ├── CollaborativeActor.ts # CRDT document
│   ├── types.ts              # TypeScript types
│   └── __tests__/
│       ├── PeerActor.test.ts
│       ├── CollaborativeActor.test.ts
│       └── integration.test.ts
└── examples/
    ├── todos/                # TodosActor example
    └── websocket/            # WebSocketPeerActor example
```

## Dependencies

```json
{
  "name": "@d-buckner/ensemble-collaborative",
  "dependencies": {
    "@d-buckner/ensemble-core": "*",
    "@automerge/automerge": "^2.2.8"
  },
  "peerDependencies": {
    "@d-buckner/ensemble-core": "*"
  }
}
```

**Bundle impact:**
- Automerge: ~27KB gzipped
- Package code: ~2-3KB gzipped
- **Total**: ~30KB gzipped (only when imported)

## Transport Implementations

The package will include concrete transport implementations to make it production-ready. These extend PeerActor and provide real network connectivity.

### WebSocketActor

**Responsibility:** WebSocket-based peer connectivity with automatic reconnection

```typescript
interface WebSocketState extends PeerState {
  url: string;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  reconnectAttempts: number;
}

interface WebSocketEvents extends PeerEvents {
  connectionStateChanged: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  error: { code: string; message: string };
}

class WebSocketActor extends PeerActor {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 1000;

  static override readonly initialState: WebSocketState = {
    ...PeerActor.initialState,
    url: '',
    connectionState: 'disconnected',
    reconnectAttempts: 0
  };

  constructor(config: { peerId: string; url: string }) {
    super(config);
    this.setState(draft => {
      (draft as WebSocketState).url = config.url;
    });
  }

  @action
  connect(): void {
    const state = this.state as WebSocketState;

    if (state.connectionState === 'connecting' || state.connectionState === 'connected') {
      return;
    }

    this.setState(draft => {
      (draft as WebSocketState).connectionState = 'connecting';
    });
    this.emit('connectionStateChanged' as any, 'connecting');

    this.socket = new WebSocket(state.url);

    this.socket.onopen = () => {
      this.setState(draft => {
        (draft as WebSocketState).connectionState = 'connected';
        (draft as WebSocketState).reconnectAttempts = 0;
      });
      this.emit('connectionStateChanged' as any, 'connected');
    };

    this.socket.onmessage = (event) => {
      const { type, from, data } = JSON.parse(event.data);

      if (type === 'peer-connected') {
        this.connectPeer(from);
      } else if (type === 'peer-disconnected') {
        this.disconnectPeer(from);
      } else if (type === 'message') {
        this.receiveMessage(from, new Uint8Array(data));
      }
    };

    this.socket.onerror = () => {
      this.emit('error' as any, {
        code: 'WEBSOCKET_ERROR',
        message: 'WebSocket connection error'
      });
    };

    this.socket.onclose = () => {
      this.handleDisconnect();
    };
  }

  @action
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }

    const peers = [...this.state.connectedPeers];
    for (const peerId of peers) {
      this.disconnectPeer(peerId);
    }

    this.setState(draft => {
      (draft as WebSocketState).connectionState = 'disconnected';
      (draft as WebSocketState).reconnectAttempts = 0;
    });
    this.emit('connectionStateChanged' as any, 'disconnected');
  }

  @action
  override sendTo(peerId: string, message: Uint8Array): void {
    const state = this.state as WebSocketState;

    if (state.connectionState !== 'connected' || !this.socket) {
      this.emit('error' as any, {
        code: 'NOT_CONNECTED',
        message: 'Cannot send: WebSocket not connected'
      });
      return;
    }

    this.socket.send(JSON.stringify({
      type: 'message',
      to: peerId,
      data: Array.from(message)
    }));

    super.sendTo(peerId, message);
  }

  private handleDisconnect(): void {
    const state = this.state as WebSocketState;

    if (state.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState(draft => {
        (draft as WebSocketState).connectionState = 'disconnected';
      });
      this.emit('connectionStateChanged' as any, 'disconnected');
      this.emit('error' as any, {
        code: 'MAX_RECONNECT_ATTEMPTS',
        message: 'Failed to reconnect'
      });
      return;
    }

    this.setState(draft => {
      (draft as WebSocketState).connectionState = 'reconnecting';
      (draft as WebSocketState).reconnectAttempts++;
    });
    this.emit('connectionStateChanged' as any, 'reconnecting');

    const delay = this.reconnectDelay * Math.pow(2, state.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
```

**Features:**
- ✅ Automatic reconnection with exponential backoff
- ✅ Connection state tracking (disconnected/connecting/connected/reconnecting)
- ✅ Error reporting via events
- ✅ Graceful disconnect cleanup

**Usage:**
```typescript
const WebSocketToken = createActorToken<WebSocketActor>('websocket');
const TodosToken = createActorToken<TodosActor>('todos');

system.register({
  token: WebSocketToken,
  actor: WebSocketActor
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: {
    peer: WebSocketToken
  }
});

// UI: Monitor connection
const wsClient = system.getClient(WebSocketToken);

wsClient.on('connectionStateChanged', (state) => {
  setConnectionStatus(state);
});

wsClient.on('error', ({ code, message }) => {
  console.error(`[${code}]:`, message);
});

wsClient.actions.connect();
```

### WebRTCActor

**Responsibility:** WebRTC peer-to-peer connectivity with signaling support

```typescript
interface WebRTCState extends PeerState {
  signalingUrl: string;
  connectionStates: Record<string, RTCPeerConnectionState>;
}

interface WebRTCEvents extends PeerEvents {
  peerConnectionStateChanged: { peerId: string; state: RTCPeerConnectionState };
  needsSignaling: { type: 'offer' | 'answer' | 'ice-candidate'; peerId: string; data: unknown };
}

class WebRTCActor extends PeerActor {
  private connections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private signalingSocket?: WebSocket;

  private readonly rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  static override readonly initialState: WebRTCState = {
    ...PeerActor.initialState,
    signalingUrl: '',
    connectionStates: {}
  };

  constructor(config: { peerId: string; signalingUrl: string; rtcConfig?: RTCConfiguration }) {
    super(config);

    this.setState(draft => {
      (draft as WebRTCState).signalingUrl = config.signalingUrl;
    });

    if (config.rtcConfig) {
      this.rtcConfig = config.rtcConfig;
    }
  }

  @action
  connectToSignaling(): void {
    const state = this.state as WebRTCState;
    this.signalingSocket = new WebSocket(state.signalingUrl);

    this.signalingSocket.onmessage = (event) => {
      const { type, from, data } = JSON.parse(event.data);

      if (type === 'offer') {
        this.handleOffer(from, data);
      } else if (type === 'answer') {
        this.handleAnswer(from, data);
      } else if (type === 'ice-candidate') {
        this.handleIceCandidate(from, data);
      } else if (type === 'peer-available') {
        this.initiateConnection(from);
      }
    };
  }

  @action
  async initiateConnection(peerId: string): Promise<void> {
    const pc = this.createPeerConnection(peerId);
    const dc = pc.createDataChannel('sync', { ordered: true });
    this.setupDataChannel(peerId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.emit('needsSignaling' as any, { type: 'offer', peerId, data: offer });
    this.signalingSocket?.send(JSON.stringify({
      type: 'offer',
      to: peerId,
      data: offer
    }));
  }

  @action
  override sendTo(peerId: string, message: Uint8Array): void {
    const dc = this.dataChannels.get(peerId);

    if (!dc || dc.readyState !== 'open') {
      this.emit('error' as any, {
        code: 'DATACHANNEL_NOT_READY',
        message: `Cannot send to ${peerId}: data channel not ready`
      });
      return;
    }

    dc.send(message);
    super.sendTo(peerId, message);
  }

  @action
  override disconnectPeer(peerId: string): void {
    const pc = this.connections.get(peerId);
    const dc = this.dataChannels.get(peerId);

    dc?.close();
    pc?.close();

    this.connections.delete(peerId);
    this.dataChannels.delete(peerId);

    super.disconnectPeer(peerId);
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.connections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('needsSignaling' as any, {
          type: 'ice-candidate',
          peerId,
          data: event.candidate
        });
        this.signalingSocket?.send(JSON.stringify({
          type: 'ice-candidate',
          to: peerId,
          data: event.candidate
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      this.setState(draft => {
        (draft as WebRTCState).connectionStates[peerId] = pc.connectionState;
      });

      this.emit('peerConnectionStateChanged' as any, { peerId, state: pc.connectionState });

      if (pc.connectionState === 'connected') {
        this.connectPeer(peerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.disconnectPeer(peerId);
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    return pc;
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(peerId, dc);

    dc.onmessage = (event) => {
      this.receiveMessage(peerId, new Uint8Array(event.data));
    };

    dc.onopen = () => {
      this.connectPeer(peerId);
    };

    dc.onclose = () => {
      this.disconnectPeer(peerId);
    };
  }

  private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.createPeerConnection(peerId);
    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.emit('needsSignaling' as any, { type: 'answer', peerId, data: answer });
    this.signalingSocket?.send(JSON.stringify({
      type: 'answer',
      to: peerId,
      data: answer
    }));
  }

  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.connections.get(peerId);
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidate): Promise<void> {
    const pc = this.connections.get(peerId);
    if (pc) {
      await pc.addIceCandidate(candidate);
    }
  }
}
```

**Features:**
- ✅ True peer-to-peer connectivity (no central server for data)
- ✅ Signaling server integration (for connection setup)
- ✅ Per-peer connection state tracking
- ✅ ICE candidate handling
- ✅ Configurable STUN/TURN servers

**Usage:**
```typescript
const WebRTCToken = createActorToken<WebRTCActor>('webrtc');
const TodosToken = createActorToken<TodosActor>('todos');

system.register({
  token: WebRTCToken,
  actor: WebRTCActor
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: {
    peer: WebRTCToken
  }
});

// UI: Monitor P2P connections
const rtcClient = system.getClient(WebRTCToken);

rtcClient.on('peerConnectionStateChanged', ({ peerId, state }) => {
  console.log(`Peer ${peerId}:`, state);
});

rtcClient.actions.connectToSignaling();
rtcClient.actions.initiateConnection('other-peer-id');
```

### Package Structure (Updated)

```
packages/collaborative/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Public exports (all actors)
│   ├── PeerActor.ts          # Base peer management
│   ├── CollaborativeActor.ts # CRDT document
│   ├── WebSocketActor.ts     # WebSocket transport
│   ├── WebRTCActor.ts        # WebRTC transport
│   ├── types.ts              # TypeScript types
│   └── __tests__/
│       ├── PeerActor.test.ts
│       ├── CollaborativeActor.test.ts
│       ├── WebSocketActor.test.ts
│       ├── WebRTCActor.test.ts
│       └── integration.test.ts
└── examples/
    ├── todos-websocket/      # TodosActor + WebSocketActor
    └── todos-webrtc/         # TodosActor + WebRTCActor
```

**Exports:**
```typescript
// src/index.ts
export { PeerActor } from './PeerActor';
export { CollaborativeActor } from './CollaborativeActor';
export { WebSocketActor } from './WebSocketActor';
export { WebRTCActor } from './WebRTCActor';
export type {
  PeerState,
  PeerEvents,
  CollaborativeEvents,
  WebSocketState,
  WebSocketEvents,
  WebRTCState,
  WebRTCEvents
} from './types';
```

## Migration Path

### Phase 1: Core Implementation (MVP)
1. Create package structure
2. Implement PeerActor (base peer management)
3. Implement CollaborativeActor (setState override + effects)
4. Add TypeScript types
5. Unit tests for PeerActor and CollaborativeActor
6. Integration tests (two-peer sync with manual message forwarding)
7. Basic documentation

**Deliverable:** Base package with PeerActor + CollaborativeActor. Users can integrate with external WebSocket/WebRTC.

### Phase 2: WebSocket Transport
1. Implement WebSocketActor (extends PeerActor)
2. Add reconnection logic with exponential backoff
3. Connection state management
4. Error handling and reporting
5. Unit tests for WebSocketActor
6. Integration tests with real WebSocket server
7. Example: `examples/todos-websocket`

**Deliverable:** Production-ready WebSocket transport included in package.

### Phase 3: WebRTC Transport
1. Implement WebRTCActor (extends PeerActor)
2. Signaling integration
3. ICE candidate handling
4. Per-peer connection state tracking
5. Unit tests for WebRTCActor
6. Integration tests with signaling server
7. Example: `examples/todos-webrtc`

**Deliverable:** Production-ready WebRTC transport for P2P use cases.

### Phase 4: Polish & Documentation
1. Comprehensive README
2. API reference documentation
3. Migration guides
4. Performance benchmarks
5. Best practices guide
6. Production deployment examples

## Future Enhancements

### 1. Persistence Adapter

```typescript
interface PersistenceAdapter {
  save(documentId: string, data: Uint8Array): Promise<void>;
  load(documentId: string): Promise<Uint8Array | null>;
}

class TodosActor extends CollaborativeActor<TodoDoc> {
  private persistence?: PersistenceAdapter;

  async onInit() {
    if (this.persistence) {
      const saved = await this.persistence.load(this.documentId);
      if (saved) {
        this.automergeDoc = Automerge.load(saved);
        super.setState(draft => {
          Object.assign(draft, Automerge.toJS(this.automergeDoc));
        });
      }
    }
  }

  @effect('this.sendSyncMessage')
  private async persistChanges() {
    if (this.persistence) {
      const data = Automerge.save(this.automergeDoc);
      await this.persistence.save(this.documentId, data);
    }
  }
}
```

### 2. Presence Tracking

```typescript
interface PresenceState {
  cursors: Map<string, { line: number; column: number }>;
  selections: Map<string, { start: number; end: number }>;
}

class PresenceActor extends Actor<PresenceState, PresenceEvents> {
  // Track peer presence (cursors, selections, etc.)
  // Ephemeral state, not persisted
}
```

### 3. Time-Travel Debugging

```typescript
class CollaborativeActor<TDoc> {
  private history: AutomergeDoc<TDoc>[] = [];

  protected setState(updater: (draft: Draft<TDoc>) => void): void {
    const newDoc = Automerge.change(this.automergeDoc, updater);
    this.history.push(newDoc); // Record history
    // ...
  }

  @action
  revertTo(index: number): void {
    this.automergeDoc = this.history[index];
    super.setState(draft => {
      Object.assign(draft, Automerge.toJS(this.automergeDoc));
    });
  }
}
```

### 4. WebRTC Transport

```typescript
class WebRTCPeerActor extends PeerActor {
  private connections = new Map<string, RTCPeerConnection>();

  @action
  async connectPeer(peerId: string, offer?: RTCSessionDescriptionInit): Promise<void> {
    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel('sync');

    dc.onmessage = (event) => {
      this.receiveMessage(peerId, new Uint8Array(event.data));
    };

    this.connections.set(peerId, pc);
    // WebRTC signaling...
  }

  @action
  sendTo(peerId: string, message: Uint8Array): void {
    const pc = this.connections.get(peerId);
    const dc = pc?.getDataChannel('sync');
    dc?.send(message);
    super.sendTo(peerId, message);
  }
}
```

## Open Questions

1. **Should CollaborativeActor provide document ID management?**
   - **Option A**: Add `documentId` to constructor, manage internally
   - **Option B**: Let users manage document IDs in their extension
   - **Recommendation**: Option B - keep base class minimal

2. **Should we provide built-in persistence hooks?**
   - **Option A**: Add optional `onSave()/onLoad()` lifecycle hooks
   - **Option B**: Let users implement via effects
   - **Recommendation**: Option B initially - users can add via `@effect('this.sendSyncMessage')`

3. **Should PeerActor track connection quality/latency?**
   - **Option A**: Add metrics to PeerState (latency, packet loss)
   - **Option B**: Leave to transport-specific extensions
   - **Recommendation**: Option B - keep base minimal

4. **Should we support partial document sync?**
   - **Option A**: Allow syncing subsets of document
   - **Option B**: Always sync full document
   - **Recommendation**: Option B initially - Automerge handles this efficiently already

## Success Criteria

✅ **API Clarity:**
- Users can extend CollaborativeActor and add domain actions
- No CRDT knowledge required for basic usage
- State is direct document type (no wrapper)

✅ **Actor Model Purity:**
- All communication via effects (no public sync methods)
- Clean dependency (CollaborativeActor depends on PeerActor)
- No networking knowledge in CRDT code

✅ **Transport Flexibility:**
- PeerActor can be extended for WebSocket, WebRTC, etc.
- Or used with external transport via events
- No coupling to specific transport

✅ **Performance:**
- Efficient sync (only changed data)
- Minimal overhead vs direct Automerge usage
- Scales to 10+ concurrent peers

✅ **Testing:**
- Unit tests for both actors
- Integration tests for sync scenarios
- Example apps demonstrating usage

## Conclusion

This proposal provides collaborative CRDT capabilities while maintaining the actor model's principles:

- **State ownership**: Each actor owns its state (PeerActor = peers, CollaborativeActor = document)
- **Message passing**: All communication via actions and effects
- **Dependency injection**: CollaborativeActor depends on PeerActor
- **Clean abstractions**: CRDT logic separated from networking

The two-actor design enables:
- **Reusability**: PeerActor extensible for different transports
- **Testability**: CRDT and networking tested independently
- **Clarity**: Users work with domain model (TodoDoc), not CRDT internals

Key innovations:
- ✅ Document IS state (no wrapper)
- ✅ setState override for transparent CRDT
- ✅ Effect-driven sync (no public sync methods)
- ✅ Users extend and add domain actions
