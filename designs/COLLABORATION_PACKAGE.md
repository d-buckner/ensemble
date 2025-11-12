# Collaboration CRDT Package: Design Proposal

## Overview

This proposal introduces `@d-buckner/ensemble-collaboration`, a package providing collaborative editing capabilities through Conflict-Free Replicated Data Types (CRDTs) using Automerge.

**Core components:**
- **PeerMessagingActor** - Tracks peer connections and routes messages to appropriate transport
- **WebSocketActor** - Socket.IO client for signaling and fallback transport
- **WebRTCActor** - peer-pressure wrapper for WebRTC P2P data channels
- **CollaborationActor<TDoc>** - Generic CRDT document manager where TDoc IS the actor state

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

### Four-Actor Design

```
WebSocketActor + WebRTCActor (transport implementations)
              ↓
        PeerMessagingActor (state tracker)
              ↓ (dependency via @effect)
     CollaborationActor<TDoc> (CRDT management)
```

**Separation of concerns:**
- **WebSocketActor**: Socket.IO connection, signaling, fallback transport
- **WebRTCActor**: WebRTC peer-pressure wrapper, P2P data channels
- **PeerMessagingActor**: Tracks peer state and routes messages to transports
- **CollaborationActor**: CRDT operations, conflict resolution

### Why Four Actors?

1. **Single Responsibility** - Each actor has one clear purpose
2. **Coordinated Routing** - PeerMessagingActor coordinates transport selection based on peer state
3. **Transport Independence** - WebSocket and WebRTC actors are independent implementations
4. **Testability** - Can test CRDT logic, routing coordination, and transports independently
5. **Actor Model Purity** - Each actor has clear state ownership and event boundaries

## Component Design

### 1. PeerMessagingActor

**Responsibility:** Central coordinator for peer connections and message routing

**State:**
- `connectedPeers: string[]` - List of connected peer IDs
- `peerTransports: Record<peerId, 'webrtc' | 'websocket'>` - Active transport per peer

**Events:**
- `peerConnected: string` - Peer is ready for communication
- `peerDisconnected: string` - Peer left
- `transportChanged: { peerId: string; transport: 'webrtc' | 'websocket' }` - Transport switched
- `messageReceived: { peerId: string; message: Uint8Array }` - Incoming message (normalized from both transports)
- `signalingReceived: { peerId: string; data: unknown }` - WebRTC signaling forwarded to WebRTCActor

**Actions:**
- `sendTo(peerId, message)` - Route message to appropriate transport
- `broadcast(message)` - Send to all connected peers

**Dependencies:**
- `websocket: IActorClient<WebSocketActor>` - For fallback transport
- `webrtc: IActorClient<WebRTCActor>` - For P2P transport

**Key Behaviors:**
- Listens to WebSocketActor and WebRTCActor via effects (one-way, no circular dependency)
- Updates state when peers join/leave or transport changes
- Routes messages based on `peerTransports` state
- Normalizes incoming messages from both transports
- Coordinates WebRTC signaling between WebRTCActor and WebSocketActor
- Single source of truth for peer connectivity

### 2. WebSocketActor

**Responsibility:** Socket.IO client for signaling and fallback transport

**State:**
- `url: string`, `roomId: string`, `connectionState: string`

**Events:**
- `roomJoined`, `peerJoined`, `peerLeft`, `signalingMessage`, `messageReceived`

**Actions:**
- `joinRoom(roomId)`, `sendSignal(peerId, data)`, `sendTo(peerId, message)`

### 3. WebRTCActor

**Responsibility:** WebRTC P2P transport via peer-pressure

**State:**
- `peerConnectionStates: Record<peerId, 'connecting' | 'connected' | 'failed'>`

**Events:**
- `peerConnected`, `peerDisconnected`, `messageReceived`
- `signalingData: { peerId: string; data: unknown }` - Outbound signaling data for peer

**Actions:**
- `sendTo(peerId, message)` - Send CRDT message via WebRTC data channel

**Dependencies:**
- None (fully decoupled from transports)

### 4. CollaborationActor

**Responsibility:** Pure CRDT document management

**Core innovation:** TDoc IS the state. No wrapper, no metadata.

```typescript
interface CollaborationEvents {
  // No events needed - uses PeerMessagingActor for all peer communication
}

interface CollaborationDeps {
  connection: IActorClient<PeerMessagingActor>;  // Single dependency!
}

interface CollaborationActions {
  // Actions for collaboration operations
}

class CollaborationActor<TDoc> extends Actor<TDoc, CollaborationActions, CollaborationEvents> {
  // Automerge internals (private, NOT in state)
  private automergeDoc: AutomergeDoc<TDoc>;
  private syncStates = new Map<string, SyncState>();

  protected declare deps: CollaborationDeps;

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

    // 3. Generate and send sync messages for peers
    if (changes.length > 0) {
      const peers = this.deps.connection.state.connectedPeers;
      for (const peerId of peers) {
        const syncMsg = this.generateSyncMessageForPeer(peerId);
        if (syncMsg) {
          // PeerMessagingActor handles routing to appropriate transport
          this.deps.connection.actions.sendTo(peerId, syncMsg);
        }
      }
    }
  }

  // ========================================
  // Effects: React to connection events
  // ========================================

  @effect('connection.messageReceived')
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
      // PeerMessagingActor handles routing
      this.deps.connection.actions.sendTo(peerId, responseMsg);
    }
  }

  @effect('connection.peerConnected')
  private initSyncWithPeer(peerId: string): void {
    const syncState = Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );

    if (message) {
      this.syncStates.set(peerId, newSyncState);
      // PeerMessagingActor handles routing
      this.deps.connection.actions.sendTo(peerId, message);
    }
  }

  @effect('connection.peerDisconnected')
  private cleanupPeer(peerId: string): void {
    this.syncStates.delete(peerId);
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
- **Minimal networking knowledge** - Queries connected peers, delegates routing to PeerMessagingActor
- **Clean state** - Metadata (automergeDoc, syncStates) kept private, not in state

## Usage Patterns

### Basic Setup

Users extend CollaborationActor and add domain-specific actions:

```typescript
import {
  CollaborationActor,
  PeerMessagingActor,
  WebSocketActor,
  WebRTCActor
} from '@d-buckner/ensemble-collaboration';
import { createActorToken, ActorSystem, action } from '@d-buckner/ensemble-core';

// 1. Define document type
interface TodoDoc {
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// 2. Extend CollaborationActor with domain actions
class TodosActor extends CollaborationActor<TodoDoc> {
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

// 3. Register actors with dependencies
const WebSocketToken = createActorToken<WebSocketActor>('websocket');
const WebRTCToken = createActorToken<WebRTCActor>('webrtc');
const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
const TodosToken = createActorToken<TodosActor>('todos');

const system = new ActorSystem();

system.register({ token: WebSocketToken, actor: WebSocketActor });

system.register({
  token: PeerMessagingToken,
  actor: PeerMessagingActor,
  dependencies: { websocket: WebSocketToken, webrtc: WebRTCToken }
});

system.register({
  token: WebRTCToken,
  actor: WebRTCActor,
  dependencies: { peerMessaging: PeerMessagingToken }
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: {
    connection: PeerMessagingToken  // Single dependency!
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

### Network Integration

The four-actor stack provides clean separation:

**Registration Flow:**
1. Register WebSocketActor (no dependencies)
2. Register PeerMessagingActor (depends on websocket + webrtc)
3. Register WebRTCActor (depends on peerMessaging)
4. Register CollaborationActor (depends on peerMessaging)

**Runtime Flow:**
1. User joins room via `websocket.actions.joinRoom(roomId)`
2. PeerMessagingActor tracks peer connections via effects
3. WebRTCActor establishes P2P connections
4. CollaborationActor calls PeerMessagingActor actions to send messages
5. PeerMessagingActor routes to appropriate transport based on peer state
6. State changes automatically sync via selected transport

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

### 3. Users Extend CollaborationActor

**Decision:** CollaborationActor is a base class, users extend it

**Rationale:**
- **Domain actions**: Users add `addTodo()`, `toggleTodo()`, etc.
- **Type safety**: `TodosActor extends CollaborationActor<TodoDoc>`
- **Encapsulation**: Business logic lives with state definition
- **Familiar pattern**: Same as extending `Actor` in core framework

**Alternative considered:** Direct use of CollaborationActor
- ❌ Would force all mutations through generic `setState()` from outside
- ❌ Would lose encapsulation of business logic
- ✅ Extension enables domain-specific APIs

### 4. Effects for Sync (Not Public Actions)

**Decision:** Sync handled via effects, not public `receiveSyncMessage()` action

**Rationale:**
- **Actor model purity**: All inter-actor communication via effects
- **Clean API**: Only domain actions exposed (`addTodo`, not `receiveSyncMessage`)
- **Automatic wiring**: Effects set up by ActorSystem, no manual subscription
- **Separation of concerns**: Users interact with domain API, sync happens internally

**Effect chain:**
```
WebRTCActor/WebSocketActor receives data
  → emits 'messageReceived' event
    → PeerMessagingActor @effect('webrtc/websocket.messageReceived')
      → emits normalized 'messageReceived' event
        → CollaborationActor @effect('connection.messageReceived')
          → applies Automerge changes
            → calls connection.actions.sendTo()
              → PeerMessagingActor routes to appropriate transport
```

### 5. PeerMessagingActor for Routing & State

**Decision:** PeerMessagingActor handles both state tracking AND message routing

**Rationale:**
- **Single responsibility**: PeerMessagingActor = peer communication layer
- **Simplified dependencies**: CollaborationActor only depends on PeerMessagingActor
- **Encapsulated routing**: Routing logic lives with the state it depends on
- **Event normalization**: Single `messageReceived` event from PeerMessagingActor
- **No circular dependencies**: PeerMessagingActor listens to transports via effects (one-way)

**Alternative considered:** CollaborationActor routes messages directly to transports
- ❌ Requires CollaborationActor to depend on both WebSocket and WebRTC actors
- ❌ Tight coupling between CRDT logic and transport selection
- ❌ Per-message state queries for routing decision
- ✅ Routing in PeerMessagingActor simplifies CollaborationActor

## Lifecycle & Initialization

This section documents the system startup sequence and runtime lifecycle of the four-actor stack.

### WebSocketActor Initialization

**Constructor Parameters (Required):**
```typescript
interface WebSocketActions {
  connect(): void;
  disconnect(): void;
}

class WebSocketActor extends Actor<WebSocketState, WebSocketActions, WebSocketEvents> {
  constructor(config: { url: string; roomId: string }) {
    super({
      url: config.url,
      roomId: config.roomId,
      connectionState: 'disconnected'
    });
  }
}
```

- `url: string` - Socket.IO server URL (e.g., `'http://localhost:3000'`)
- `roomId: string` - Room identifier for peer grouping

**Key Behavior:** WebSocketActor does NOT auto-connect on construction. Connection is explicit via the `connect()` action.

### Startup Sequence

**1. System Registration:**
```typescript
const system = new ActorSystem();

// Register in dependency order
system.register({
  token: WebSocketToken,
  actor: WebSocketActor,
  constructorParams: { url: 'http://localhost:3000', roomId: 'room-123' }
});

system.register({
  token: PeerMessagingToken,
  actor: PeerMessagingActor,
  dependencies: { websocket: WebSocketToken, webrtc: WebRTCToken }
});

system.register({
  token: WebRTCToken,
  actor: WebRTCActor,
  dependencies: { peerMessaging: PeerMessagingToken }
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: { connection: PeerMessagingToken }
});

await system.start();
```

**2. Connection Initiation:**
```typescript
// Explicit connect action starts the flow
const websocket = system.get(WebSocketToken);
websocket.actions.connect();
```

**3. Server Response Flow:**
```
Client calls websocket.actions.connect()
  ↓
WebSocketActor establishes Socket.IO connection
  ↓
Server receives connection, generates unique peer ID
  ↓
Server sends room join message: { event: 'room-peers', peerId: 'abc123', peers: ['peer1', 'peer2'] }
  ↓
WebSocketActor updates state with peerId, emits roomJoined
  ↓
WebSocketActor emits peerJoined for each existing peer
  ↓
PeerMessagingActor @effect('websocket.peerJoined') adds peers to state
  ↓
WebRTCActor @effect('peerMessaging.peerConnected') creates peer-pressure instances
  ↓
WebRTC signaling begins (coordinated via PeerMessagingActor)
  ↓
System ready for collaboration
```

### Peer ID Management

**Key Principle:** Peer IDs are generated by the server, not the client.

**Why Server-Side Generation:**
- Ensures uniqueness across all peers in a room
- Prevents ID collisions from concurrent joins
- Server maintains authoritative peer roster

**Client Behavior:**
- Client NEVER generates its own peer ID
- Client receives peer ID in the `room-peers` response after calling `connect()`
- All subsequent messaging uses server-assigned peer ID

### WebRTC Connection Establishment

**Signaling Coordination via PeerMessagingActor:**

```
1. PeerMessagingActor receives websocket.peerJoined
   ↓
2. Emits peerConnected event
   ↓
3. WebRTCActor @effect('peerMessaging.peerConnected')
   ↓
4. Creates peer-pressure instance (initiator = lexicographic peerId comparison)
   ↓
5. peer-pressure generates signaling data
   ↓
6. WebRTCActor emits signalingData event
   ↓
7. PeerMessagingActor @effect('webrtc.signalingData')
   ↓
8. Calls websocket.actions.sendSignal(peerId, data)
   ↓
9. Server relays signaling to remote peer
   ↓
10. Remote peer's WebSocketActor emits signalingMessage
    ↓
11. Remote PeerMessagingActor @effect('websocket.signalingMessage')
    ↓
12. Emits signalingReceived event
    ↓
13. Remote WebRTCActor @effect('peerMessaging.signalingReceived')
    ↓
14. Calls peer.signal(data)
    ↓
15. Handshake completes → WebRTC data channel ready
    ↓
16. WebRTCActor emits peerConnected
    ↓
17. PeerMessagingActor updates transport='webrtc', emits transportChanged
```

**Key Features:**
- ✅ No direct coupling between WebRTCActor and WebSocketActor
- ✅ All signaling coordinated through PeerMessagingActor
- ✅ Deterministic initiator selection (lexicographic comparison)
- ✅ Full-mesh topology: every peer connects to every other peer

### Transport Fallback Strategy

**Primary Transport:** WebRTC (low latency, peer-to-peer)
**Fallback Transport:** WebSocket (reliable, server-relayed)

**Fallback Scenarios:**

**1. WebRTC Connection Fails:**
```typescript
// In PeerMessagingActor.sendTo()
if (transport === 'webrtc') {
  try {
    this.deps.webrtc.actions.sendTo(peerId, message);
  } catch (error) {
    // WebRTC failed, fallback to WebSocket
    this.deps.websocket.actions.sendTo(peerId, message);
  }
}
```

**2. WebRTC Data Channel Disconnects:**
```
WebRTCActor detects peer.on('close') or peer.on('error')
  ↓
Emits peerDisconnected event
  ↓
PeerMessagingActor @effect('webrtc.peerDisconnected')
  ↓
Updates transport='websocket' (fallback)
  ↓
Emits transportChanged event
  ↓
Subsequent messages automatically route via WebSocket
```

**Key Principle:** Peer remains in the room when WebRTC fails. Only when WebSocket disconnects (`websocket.peerLeft`) is the peer fully removed.

**Error Handling:**
- `WebRTCActor.sendTo()` throws error if peer not connected
- `PeerMessagingActor.sendTo()` catches error and falls back to WebSocket
- No message loss: fallback is transparent to CollaborationActor

### Race Condition Handling

**Scenario:** CRDT message arrives before peer is tracked in PeerMessagingActor state.

**Solution:**
```typescript
// In PeerMessagingActor effect handler
@effect('websocket.messageReceived')
private handleWebSocketMessage({ peerId, message }: MessagePayload): void {
  if (!this.state.connectedPeers.includes(peerId)) {
    // Peer not tracked yet - add them first
    this.setState(draft => {
      draft.connectedPeers.push(peerId);
      draft.peerTransports[peerId] = 'websocket';
    });
    this.emit('peerConnected', peerId);
  }

  // Now emit the message
  this.emit('messageReceived', { peerId, message });
}
```

**Key Feature:** Self-healing - missing peer entries are created on-demand when messages arrive.

### Reconnection Strategy

**WebSocket Reconnection (Built-in):**
- Socket.IO handles automatic reconnection
- WebSocketActor updates `connectionState` during reconnection
- On reconnect, server resends room peer list
- PeerMessagingActor reconciles state with new peer list

**WebRTC Reconnection:**
- If WebRTC data channel fails, PeerMessagingActor updates transport to 'websocket'
- Messages continue flowing via WebSocket (no interruption)
- WebRTCActor can attempt to re-establish P2P connection
- If successful, PeerMessagingActor updates transport back to 'webrtc'

**Full Disconnection:**
- If WebSocket connection lost, all peers considered disconnected
- On reconnect, full re-initialization (room join, peer discovery, WebRTC establishment)

### Shutdown Sequence

**Graceful Shutdown:**
```typescript
// User initiates disconnect
websocket.actions.leaveRoom();
  ↓
WebSocketActor sends leave-room event to server
  ↓
Server notifies other peers
  ↓
WebSocketActor disconnects socket
  ↓
Emits peerLeft for all peers
  ↓
PeerMessagingActor removes all peers from state
  ↓
WebRTCActor destroys all peer-pressure instances
  ↓
CollaborationActor cleans up sync states
```

**Cleanup Order:**
1. WebSocketActor leaves room
2. PeerMessagingActor emits `peerDisconnected` for each peer
3. WebRTCActor destroys peer instances via `@effect('peerMessaging.peerDisconnected')`
4. CollaborationActor cleans up sync states via `@effect('connection.peerDisconnected')`

### Key Initialization Insights

`★ Insight ─────────────────────────────────────`
**1. Server-Centric Architecture:** Peer IDs are server-generated to ensure uniqueness and prevent race conditions. The client is never authoritative about its own identity.

**2. Explicit Connection Lifecycle:** Unlike many Socket.IO clients that auto-connect, WebSocketActor requires an explicit `connect()` action. This gives users fine-grained control over when collaboration begins.

**3. Layered Fallback Strategy:** The system maintains connectivity at multiple levels - WebRTC can fail while WebSocket stays connected, and PeerMessagingActor automatically routes to the working transport without any awareness at the CollaborationActor level.
`─────────────────────────────────────────────────`

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
this.deps.connection.actions.sendTo(peerId, message)
  ↓
PeerMessagingActor checks peerTransports[peerId] state
  ↓
Routes to webrtc or websocket based on state
  ↓
WebRTCActor or WebSocketActor sends to network
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

**PeerMessagingActor:**
- ✅ Tracks peer connections from WebSocketActor events
- ✅ Updates transport state when WebRTCActor connects/disconnects
- ✅ Routes messages to correct transport based on peer state
- ✅ Emits `peerConnected`/`peerDisconnected` events
- ✅ Emits `transportChanged` when switching transports
- ✅ Normalizes `messageReceived` events from both transports

**WebSocketActor:**
- ✅ Socket.IO connection lifecycle
- ✅ Room join/leave functionality
- ✅ Peer discovery events
- ✅ Message send/receive

**WebRTCActor:**
- ✅ peer-pressure instance creation
- ✅ WebRTC connection lifecycle
- ✅ Signaling via WebSocketActor
- ✅ Data channel message send/receive

**CollaborationActor:**
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
│   ├── PeerMessagingActor.ts # Peer messaging state tracking
│   ├── WebSocketActor.ts     # Socket.IO transport
│   ├── WebRTCActor.ts        # WebRTC transport
│   ├── CollaborationActor.ts # CRDT document
│   ├── types.ts              # TypeScript types
│   └── __tests__/
│       ├── PeerMessagingActor.test.ts
│       ├── WebSocketActor.test.ts
│       ├── WebRTCActor.test.ts
│       ├── CollaborationActor.test.ts
│       └── integration.test.ts
└── examples/
    ├── todos/                # TodosActor example
    └── music-room/           # Real-time music collaboration example
```

## Dependencies

```json
{
  "name": "@d-buckner/ensemble-collaboration",
  "dependencies": {
    "@d-buckner/ensemble-core": "*",
    "@automerge/automerge": "^2.2.8",
    "socket.io-client": "^4.7.0",
    "peer-pressure": "^1.0.0"
  },
  "peerDependencies": {
    "@d-buckner/ensemble-core": "*"
  }
}
```

**Bundle impact:**
- Automerge: ~27KB gzipped
- Socket.IO client: ~20KB gzipped
- peer-pressure: ~6KB gzipped
- Package code: ~5KB gzipped
- **Total**: ~58KB gzipped (only when imported)

## Transport Implementations

The package will include concrete transport implementations optimized for real-time collaboration with full-mesh P2P topology.

**Architecture Overview:**
```
WebSocketActor (Socket.IO) ────┐
                                │
WebRTCActor (peer-pressure) ────┼──> PeerMessagingActor (routing coordinator)
                                │              ↓
                                └──────> CollaborationActor
                                            (delegates message routing
                                             to PeerMessagingActor)
```

**Actor Responsibilities:**

- **PeerMessagingActor:** Tracks peer state and routes messages to appropriate transport
- **WebSocketActor:** Socket.IO client for signaling and fallback message transport
- **WebRTCActor:** peer-pressure wrapper for WebRTC data channels
- **CollaborationActor:** CRDT sync logic, delegates message sending to PeerMessagingActor

**Transport Strategy:**
- **Primary:** WebRTC peer-to-peer data channels for all CRDT sync messages
- **Fallback:** WebSocket used when WebRTC data channel unavailable or fails
- **Selection:** PeerMessagingActor selects transport based on peer state when routing messages
- **Topology:** Full-mesh - every peer connects to every other peer

### PeerMessagingActor (Message Router & State Tracker)

**Responsibility:** Central coordinator for peer connections and message routing

**State:**
- `connectedPeers: string[]` - List of connected peer IDs
- `peerTransports: Record<peerId, 'webrtc' | 'websocket'>` - Active transport per peer

**Events:**
- `peerConnected: string` - Peer is ready for communication
- `peerDisconnected: string` - Peer left
- `transportChanged: { peerId: string; transport: 'webrtc' | 'websocket' }` - Transport switched
- `messageReceived: { peerId: string; message: Uint8Array }` - Incoming message (normalized from both transports)

**Actions:**
- `sendTo(peerId, message)` - Route message to appropriate transport based on `peerTransports[peerId]`
- `broadcast(message)` - Send to all connected peers

**Dependencies:**
- `websocket: IActorClient<WebSocketActor>` - For fallback transport
- `webrtc: IActorClient<WebRTCActor>` - For P2P transport

**Key Behaviors:**
- Listens to both transport actors via effects (one-way, no circular dependency)
- Updates state when peers join/leave or transport changes
- Routes outbound messages based on `peerTransports` state
- Normalizes inbound messages from both transports into single `messageReceived` event
- Single source of truth for peer connectivity

**Effect Handlers:**
- `@effect('websocket.peerJoined')` → Add peer with transport='websocket', emit `peerConnected`
- `@effect('websocket.peerLeft')` → Remove peer from state, emit `peerDisconnected`
- `@effect('websocket.signalingMessage')` → Emit `signalingReceived` (forwarded to WebRTCActor)
- `@effect('webrtc.signalingData')` → Call `websocket.actions.sendSignal()` (forward to server)
- `@effect('webrtc.peerConnected')` → Update transport='webrtc', emit `transportChanged`
- `@effect('webrtc.peerDisconnected')` → Update transport='websocket' (fallback), emit `transportChanged`
- `@effect('websocket.messageReceived')` → Emit `messageReceived` (normalized)
- `@effect('webrtc.messageReceived')` → Emit `messageReceived` (normalized)

**Action Implementation:**
```typescript
@action
sendTo(peerId: string, message: Uint8Array): void {
  const transport = this.state.peerTransports[peerId];
  if (transport === 'webrtc') {
    try {
      this.deps.webrtc.actions.sendTo(peerId, message);
    } catch (error) {
      // WebRTC failed, fallback to WebSocket
      this.deps.websocket.actions.sendTo(peerId, message);
    }
  } else {
    this.deps.websocket.actions.sendTo(peerId, message);
  }
}
```

**Key Features:**
- ✅ Single source of truth for peer state
- ✅ Tracks active transport per peer
- ✅ Encapsulates routing logic - CollaborationActor doesn't know about transports
- ✅ Normalizes events from both transports
- ✅ No circular dependencies (only listens to transports via effects)

### WebSocketActor (Socket.IO Client)

**Responsibility:** Room-based signaling and fallback transport using Socket.IO

**Primary Use Cases:**
1. WebRTC signaling (offers, answers, ICE candidates)
2. Room management (join/leave, peer discovery)
3. Fallback transport when WebRTC unavailable

**State:**
- `url: string` - Socket.IO server URL
- `roomId: string` - Current room ID
- `connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'`

**Events:**
- `roomJoined: { roomId: string; peerIds: string[] }` - Joined room with peer list
- `peerJoined: string` - New peer joined room
- `peerLeft: string` - Peer left room
- `signalingMessage: { from: string; data: unknown }` - WebRTC signaling data
- `messageReceived: { peerId: string; message: Uint8Array }` - Fallback CRDT message

**Actions:**
- `joinRoom(roomId)` - Join Socket.IO room
- `leaveRoom()` - Leave current room
- `sendSignal(peerId, data)` - Send WebRTC signaling
- `sendTo(peerId, message)` - Send CRDT message (fallback transport)

**Socket.IO Event Handlers:**
- `room-peers` → Emit `roomJoined` with peer list
- `peer-joined` → Emit `peerJoined`
- `peer-left` → Emit `peerLeft`
- `webrtc-signal` → Emit `signalingMessage`
- `sync-message` → Emit `messageReceived`

**Key Features:**
- ✅ Socket.IO built-in reconnection
- ✅ Room-based peer discovery
- ✅ WebRTC signaling transport
- ✅ Fallback for CRDT sync when WebRTC unavailable
- ✅ Server handles message routing

### WebRTCActor (peer-pressure)

**Responsibility:** WebRTC P2P transport using data channels, backed by peer-pressure library

**State:**
- `peerConnectionStates: Record<peerId, 'connecting' | 'connected' | 'failed'>` - WebRTC state per peer

**Events:**
- `peerConnected: string` - WebRTC data channel ready for peer
- `peerDisconnected: string` - WebRTC data channel closed/failed
- `messageReceived: { peerId: string; message: Uint8Array }` - Data from peer
- `signalingData: { peerId: string; data: unknown }` - Outbound signaling data for peer

**Actions:**
- `sendTo(peerId, message)` - Send via WebRTC data channel (throws if peer not connected)

**Dependencies:**
- `peerMessaging: IActorClient<PeerMessagingActor>` - For peer lifecycle and signaling coordination

**Key Behaviors:**
- Creates peer-pressure `Peer` instance for each peer
- Emits signaling data that PeerMessagingActor routes to WebSocketActor
- Receives signaling data from PeerMessagingActor (forwarded from WebSocketActor)
- Sends/receives CRDT messages via WebRTC data channels
- Fully decoupled from WebSocketActor

**Effect Handlers:**
- `@effect('peerMessaging.peerConnected')` → Create peer-pressure instance
  - Determines initiator via lexicographic peerId comparison
  - Sets up peer event handlers (signal, connect, data, close, error)
- `@effect('peerMessaging.signalingReceived')` → Call `peer.signal(data)`
- `@effect('peerMessaging.peerDisconnected')` → Destroy peer instance

**peer-pressure Event Handlers:**
- `peer.on('signal')` → Emit `signalingData` event (PeerMessagingActor forwards to WebSocketActor)
- `peer.on('connect')` → Emit `peerConnected` event, update state
- `peer.on('data')` → Emit `messageReceived` event
- `peer.on('close')` / `peer.on('error')` → Emit `peerDisconnected` event, clean up peer

**Key Features:**
- ✅ peer-pressure handles WebRTC complexity (offers, answers, ICE)
- ✅ Fully decoupled from WebSocketActor (signaling coordinated via PeerMessagingActor)
- ✅ Deterministic initiator selection (lexicographic peerId comparison)
- ✅ Effect-driven: listens to PeerMessagingActor for signaling and peer discovery
- ✅ Full-mesh topology: every peer connects to every other peer
- ✅ Throws error if sendTo() called on disconnected peer (PeerMessagingActor handles fallback)

### Dependency Architecture

**Four-Actor Stack:**

```
┌──────────────────────────────────────────────┐
│   CollaborationActor<TDoc>                   │
│   (CRDT document management)                 │
│   Depends on: PeerMessagingActor (single!)   │
└──────────────────────────────────────────────┘
         ↓ calls sendTo(), listens to events
┌──────────────────────────────────────────────┐
│   PeerMessagingActor                         │
│   (Router & signaling coordinator)           │
│   Depends on: WebRTCActor, WebSocketActor    │
│   Routes messages & coordinates signaling    │
└──────────────────────────────────────────────┘
    ↓ routes to          ↑ emits events (one-way!)
┌─────────────────┐    ┌──────────────────────┐
│  WebRTCActor    │    │  WebSocketActor      │
│  (P2P transport)│    │  (Signaling+fallback)│
│  Depends on: PM │    │  No dependencies     │
└─────────────────┘    └──────────────────────┘
```

**Design Rationale:**

1. **WebSocketActor (Foundation Layer)**
   - Room-based peer discovery via Socket.IO
   - WebRTC signaling transport (offers, answers, ICE)
   - Fallback message transport when WebRTC unavailable
   - No dependencies on other actors

2. **PeerMessagingActor (Routing & Signaling Layer)**
   - Owns peer connection state and active transport per peer
   - Routes outbound messages to appropriate transport based on state
   - Coordinates WebRTC signaling between WebRTCActor and WebSocketActor
   - Normalizes inbound messages from both transports
   - Listens to both transport actors via effects (one-way, no circular deps)
   - Encapsulates all transport selection logic

3. **WebRTCActor (P2P Transport Layer)**
   - Depends on PeerMessagingActor for peer lifecycle and signaling
   - Manages peer-pressure instances per peer
   - Handles WebRTC data channel lifecycle
   - Reports connection state to PeerMessagingActor
   - Fully decoupled from WebSocketActor

4. **CollaborationActor (Application Layer)**
   - Depends only on PeerMessagingActor (single dependency!)
   - Calls `connection.actions.sendTo()` - routing handled automatically
   - Listens to `connection.messageReceived` - normalized from both transports
   - Clean separation: CRDT logic completely isolated from transport concerns

**Message Flow:**

**Peer Discovery:**
- Client joins Socket.IO room → server broadcasts peer list
- WebSocketActor emits `peerJoined` events
- PeerMessagingActor adds peer to state, emits `peerConnected`
- WebRTCActor reacts via `@effect('peerMessaging.peerConnected')`

**WebRTC Connection Establishment:**
- WebRTCActor creates peer-pressure instance (initiator determined by lexicographic peerId comparison)
- peer-pressure emits signaling data → WebRTCActor emits `signalingData` event
- PeerMessagingActor forwards signaling to WebSocketActor via `@effect('webrtc.signalingData')`
- WebSocketActor sends signaling to server → server relays to peer
- Remote peer's WebSocketActor receives signaling → emits `signalingMessage`
- Remote PeerMessagingActor forwards to WebRTCActor via `@effect('websocket.signalingMessage')`
- Handshake completes → WebRTC data channel ready
- WebRTCActor emits `peerConnected`, PeerMessagingActor updates transport='webrtc'

**CRDT Synchronization:**
- CollaborationActor state change → generates Automerge sync message
- Calls `connection.actions.sendTo(peerId, message)`
- PeerMessagingActor routes based on `peerTransports[peerId]` state
- If 'webrtc': routes to `webrtc.actions.sendTo()`
- If 'websocket': routes to `websocket.actions.sendTo()`
- Remote peer receives → Automerge applies → state converges

**Transport Selection Strategy:**
- PeerMessagingActor handles routing automatically
- CollaborationActor doesn't know about transports - just calls `connection.sendTo()`
- WebRTC preferred: low latency, no server relay
- WebSocket fallback: automatic when WebRTC unavailable
- No per-message overhead: routing decision made once per peer state change

### Socket.IO Server Protocol

The server implementation (separate codebase) needs to handle:

**Events:**
- `join-room` → Add client to room, broadcast peer list
- `leave-room` → Remove client, notify peers
- `webrtc-signal` → Relay signaling between specific peers
- `sync-message` → Relay CRDT sync (fallback transport only)

**Room Management:**
- Track which peers are in which rooms
- Broadcast peer join/leave events
- Route messages between specific peers

### Package Structure (Updated)

```
packages/collaborative/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Public exports (all actors)
│   ├── PeerMessagingActor.ts # Peer messaging state tracker
│   ├── CollaborationActor.ts # CRDT document
│   ├── WebSocketActor.ts     # WebSocket transport
│   ├── WebRTCActor.ts        # WebRTC transport
│   ├── types.ts              # TypeScript types
│   └── __tests__/
│       ├── PeerMessagingActor.test.ts
│       ├── CollaborationActor.test.ts
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
export { PeerMessagingActor } from './PeerMessagingActor';
export { WebSocketActor } from './WebSocketActor';
export { WebRTCActor } from './WebRTCActor';
export { CollaborationActor } from './CollaborationActor';
export type {
  PeerMessagingState,
  PeerMessagingEvents,
  WebSocketState,
  WebSocketEvents,
  WebRTCState,
  WebRTCEvents,
  CollaborationEvents
} from './types';
```

## Migration Path

### Phase 1: Core Implementation (MVP)
1. Create package structure
2. Implement PeerMessagingActor (state tracking + routing coordination)
3. Implement WebSocketActor (Socket.IO client)
4. Implement WebRTCActor (peer-pressure wrapper)
5. Implement CollaborationActor (setState override + effects)
6. Add TypeScript types
7. Unit tests for all actors
8. Integration tests (full four-actor stack)
9. Basic documentation

**Deliverable:** Complete package with all four actors, ready for production use.

### Phase 2: Examples & Documentation
1. Example: `examples/todos` - Basic collaborative todo list
2. Example: `examples/music-room` - Real-time music collaboration (p2piano-style)
3. Comprehensive README
4. API reference documentation
5. Migration guides
6. Best practices guide

**Deliverable:** Production-ready package with comprehensive examples and documentation.

### Phase 3: Polish & Optimization
1. Performance benchmarks
2. Bundle size optimization
3. Production deployment examples
4. Error handling improvements
5. DevTools integration
6. Monitoring/observability hooks

**Deliverable:** Production-hardened package with observability and optimization.

## Future Enhancements

### 1. Persistence Adapter

```typescript
interface PersistenceAdapter {
  save(documentId: string, data: Uint8Array): Promise<void>;
  load(documentId: string): Promise<Uint8Array | null>;
}

class TodosActor extends CollaborationActor<TodoDoc> {
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

interface PresenceActions {
  updateCursor(peerId: string, position: { line: number; column: number }): void;
  updateSelection(peerId: string, range: { start: number; end: number }): void;
}

class PresenceActor extends Actor<PresenceState, PresenceActions, PresenceEvents> {
  // Track peer presence (cursors, selections, etc.)
  // Ephemeral state, not persisted
}
```

### 3. Time-Travel Debugging

```typescript
class CollaborationActor<TDoc> {
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

## Open Questions

1. **Should CollaborationActor provide document ID management?**
   - **Option A**: Add `documentId` to constructor, manage internally
   - **Option B**: Let users manage document IDs in their extension
   - **Recommendation**: Option B - keep base class minimal

2. **Should we provide built-in persistence hooks?**
   - **Option A**: Add optional `onSave()/onLoad()` lifecycle hooks
   - **Option B**: Let users implement via effects
   - **Recommendation**: Option B initially - users can add via effects

3. **Should PeerMessagingActor track connection quality/latency?**
   - **Option A**: Add metrics to state (latency, packet loss per peer)
   - **Option B**: Leave to transport-specific actors
   - **Recommendation**: Option B - keep PeerMessagingActor focused on routing coordination

4. **Should we support partial document sync?**
   - **Option A**: Allow syncing subsets of document
   - **Option B**: Always sync full document
   - **Recommendation**: Option B initially - Automerge handles this efficiently already

5. **Should PeerMessagingActor expose routing as an action or let consumers query state?**
   - **Option A**: Expose `sendTo()` action that handles routing internally (current design)
   - **Option B**: Expose state, let consumers query and route themselves
   - **Recommendation**: Option A - encapsulates routing logic with the state it depends on

## Success Criteria

✅ **API Clarity:**
- Users can extend CollaborationActor and add domain actions
- No CRDT knowledge required for basic usage
- State is direct document type (no wrapper)

✅ **Actor Model Purity:**
- All communication via effects (no public sync methods)
- Clean dependencies (PeerMessagingActor ← WebSocket/WebRTC ← CollaborationActor)
- No networking knowledge in CRDT code
- Routing logic encapsulated in PeerMessagingActor

✅ **Transport Flexibility:**
- Independent WebSocketActor and WebRTCActor implementations
- PeerMessagingActor coordinates transport selection based on peer state
- CollaborationActor delegates routing to PeerMessagingActor
- No coupling between CRDT logic and transport implementation

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

- **State ownership**: Each actor owns its state (PeerMessagingActor = peer state, WebSocketActor/WebRTCActor = transport state, CollaborationActor = document)
- **Message passing**: All communication via actions and effects
- **Dependency injection**: Clear dependency chain (WebSocket → WebRTC → PeerMessaging → Collaborative)
- **Clean abstractions**: CRDT logic, state tracking, and transport completely separated

The four-actor design enables:
- **Coordinated routing**: PeerMessagingActor encapsulates transport selection with peer state
- **Transport independence**: WebSocket and WebRTC are independent, swappable implementations
- **Testability**: Each layer tested independently
- **Clarity**: Users work with domain model (TodoDoc), not CRDT or transport internals

Key innovations:
- ✅ Document IS state (no wrapper)
- ✅ setState override for transparent CRDT
- ✅ Effect-driven sync (no public sync methods)
- ✅ Routing coordinator (PeerMessagingActor encapsulates transport selection)
- ✅ Clean separation (CollaborationActor doesn't know about transports)
- ✅ Users extend CollaborationActor and add domain actions
