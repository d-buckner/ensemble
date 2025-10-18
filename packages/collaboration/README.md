# @d-buckner/ensemble-collaboration

Collaboration CRDT package for the Ensemble actor framework. Provides real-time collaboration capabilities using Automerge CRDTs with WebRTC P2P and WebSocket fallback transports.

## Features

- 🔄 **CRDT-based collaboration** - Automatic conflict resolution via Automerge
- 🌐 **WebRTC-first strategy** - Low-latency P2P connections with WebSocket fallback
- 🎭 **Actor-based architecture** - Clean separation of concerns with four specialized actors
- 📦 **Type-safe** - Full TypeScript support with generic document types
- 🔌 **Framework agnostic** - Works with any transport layer

## Architecture

The package provides four specialized actors:

```
WebSocketActor + WebRTCActor (transport implementations)
              ↓
        PeerMessagingActor (state tracker & router)
              ↓
     CollaborationActor<TDoc> (CRDT management)
```

- **CollaborationActor** - Generic CRDT document manager that users extend
- **PeerMessagingActor** - Tracks peer connections and routes messages to appropriate transport
- **WebSocketActor** - Socket.IO client for signaling and fallback transport
- **WebRTCActor** - WebRTC P2P transport for low-latency data channels

## Installation

```bash
npm install @d-buckner/ensemble-collaboration @d-buckner/ensemble-core
```

### Peer Dependencies

```bash
npm install @automerge/automerge socket.io-client simple-peer
```

## Quick Start

```typescript
import { CollaborationActor, PeerMessagingActor, WebSocketActor, WebRTCActor } from '@d-buckner/ensemble-collaboration';
import { createActorToken, ActorSystem, action } from '@d-buckner/ensemble-core';
import SimplePeer from 'simple-peer';

// 1. Define your document type
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
}

// 3. Register actors and start system
const WebSocketToken = createActorToken<WebSocketActor>('websocket');
const WebRTCToken = createActorToken<WebRTCActor>('webrtc');
const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
const TodosToken = createActorToken<TodosActor>('todos');

const system = new ActorSystem();

system.register({
  token: WebSocketToken,
  actor: WebSocketActor,
});

system.register({
  token: WebRTCToken,
  actor: WebRTCActor,
});

system.register({
  token: PeerMessagingToken,
  actor: PeerMessagingActor,
  dependencies: { websocket: WebSocketToken, webrtc: WebRTCToken }
});

system.register({
  token: TodosToken,
  actor: TodosActor,
  dependencies: { connection: PeerMessagingToken }
});

await system.start();

// 4. Initialize WebSocket connection
const websocket = system.getClient(WebSocketToken);
websocket?.actions.initialize({
  url: 'http://localhost:3001',
  roomId: 'demo-room'
});
```

## React Integration

```typescript
import { useActor } from '@d-buckner/ensemble-react';

function TodoList() {
  const { state, actions } = useActor(TodosToken);

  return (
    <div>
      <h1>Collaboration Todos</h1>
      {state.todos.map(todo => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.done}
            onChange={() => actions.toggleTodo(todo.id)}
          />
          {todo.text}
        </div>
      ))}
      <button onClick={() => actions.addTodo('New task')}>
        Add Todo
      </button>
    </div>
  );
}
```

## How It Works

### Document as State

The CRDT document **IS** the actor state directly. No wrapper objects:

```typescript
// ✅ Clean API
state.todos

// ❌ Not this
state.document.todos
```

### Transparent CRDT

Users call `setState()` like any actor, but changes automatically sync with peers:

```typescript
@action
addTodo(text: string): void {
  // Looks like normal setState, but goes through Automerge
  this.setState(draft => {
    draft.todos.push({ id: `todo-${Date.now()}`, text, done: false });
  });
  // Automatically synced with all peers!
}
```

### Effect-Driven Sync

All peer communication happens via effects - no public sync methods:

```typescript
// CollaborativeActor listens to connection events
@effect('connection.messageReceived')
private handleIncomingMessage({ peerId, message }): void {
  // Automerge handles conflict resolution
  // State updates trigger re-renders
}
```

### Transport Abstraction

PeerMessagingActor handles routing - CollaborationActor doesn't know about transports:

```typescript
// In CollaborationActor:
this.deps.connection.actions.sendTo(peerId, message);

// PeerMessagingActor automatically:
// - Routes to WebRTC if connected
// - Falls back to WebSocket if WebRTC unavailable
// - Coordinates signaling between transports
```

## API Reference

### CollaborationActor<TDoc>

Base class for collaboration actors. Users extend this and add domain actions.

**Methods:**
- `setState(updater)` - Update document (routes through Automerge)

**Effects:**
- `@effect('connection.messageReceived')` - Handle incoming sync messages
- `@effect('connection.peerConnected')` - Initialize sync with new peer
- `@effect('connection.peerDisconnected')` - Clean up peer sync state

### PeerMessagingActor

Tracks peer connections and routes messages to appropriate transport.

**State:**
- `connectedPeers: string[]` - List of connected peer IDs
- `peerTransports: Record<peerId, 'webrtc' | 'websocket'>` - Active transport per peer

**Actions:**
- `sendTo(peerId, message)` - Route message to appropriate transport
- `broadcast(message)` - Send to all connected peers

**Events:**
- `peerConnected: string` - Peer ready for communication
- `peerDisconnected: string` - Peer left
- `transportChanged: { peerId, transport }` - Transport switched
- `messageReceived: { peerId, message }` - Incoming message (normalized)

### WebSocketActor

Socket.IO client for signaling and fallback transport.

**Actions:**
- `connect()` - Connect to server and join room
- `disconnect()` - Leave room and disconnect
- `sendSignal(peerId, data)` - Send WebRTC signaling
- `sendTo(peerId, message)` - Send CRDT message (fallback)

**Events:**
- `roomJoined: { roomId, peerId, peerIds }` - Joined room successfully
- `peerJoined: string` - New peer joined
- `peerLeft: string` - Peer left
- `signalingMessage: { peerId, data }` - WebRTC signaling received

### WebRTCActor

WebRTC P2P transport using simple-peer.

**Actions:**
- `sendTo(peerId, message)` - Send via WebRTC data channel

**Events:**
- `peerConnected: string` - WebRTC data channel ready
- `peerDisconnected: string` - WebRTC connection closed
- `messageReceived: { peerId, message }` - Data from peer
- `signalingData: { peerId, data }` - Outbound signaling for peer

## Bundle Size

- Automerge: ~27KB gzipped
- Socket.IO client: ~20KB gzipped
- Simple-peer: ~6KB gzipped
- Package code: ~5KB gzipped
- **Total**: ~58KB gzipped (only when imported)

## License

Apache-2.0

## Server Package

The collaboration package includes a server implementation at `@d-buckner/ensemble-collaboration/server` for Socket.IO-based collaboration backends.

### Server Installation

```bash
npm install @d-buckner/ensemble-collaboration
```

The server package is included in the main package and requires `socket.io` as a dependency.

### Quick Start - Standalone Server

```typescript
import { CollaborationServer } from '@d-buckner/ensemble-collaboration/server';

// Create standalone server on port 3001
const server = await CollaborationServer.standalone(3001, {
  logger: console,
  onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`),
});
```

### Express Integration

```typescript
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { CollaborationServer } from '@d-buckner/ensemble-collaboration/server';

const app = express();
const httpServer = createServer(app);

// User controls Socket.IO configuration
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:5173' },
  path: '/collab',
});

// We just handle the collaboration protocol
const collaboration = new CollaborationServer(io, {
  logger: console,
  onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`),
});

// Add REST endpoints
app.get('/stats', (req, res) => {
  res.json(collaboration.getStats());
});

httpServer.listen(3001);
```

### NestJS Integration with Throttling

```typescript
import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Throttle } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { CollaborationGateway } from '@d-buckner/ensemble-collaboration/server';
import type { Socket } from 'socket.io';

@WebSocketGateway()
export class MyCollaborationGateway extends CollaborationGateway {
  constructor() {
    super({
      logger: console,
      onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`),
    });
  }

  @Throttle({ default: { limit: 100, ttl: 10000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('join-room')
  async handleJoinRoom(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    return super.handleJoinRoom(client, data);
  }

  @Throttle({ default: { limit: 100, ttl: 10000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('webrtc-signal')
  async handleWebRTCSignal(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    return super.handleWebRTCSignal(client, data);
  }

  @Throttle({ default: { limit: 100, ttl: 10000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('sync-message')
  async handleSyncMessage(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    return super.handleSyncMessage(client, data);
  }
}
```

### Server API

#### CollaborationServer

**Constructor:**
```typescript
new CollaborationServer(io: SocketIOServer, options?: CollaborationServerOptions)
```

**Options:**
- `interceptor?: MessageInterceptor` - Custom rate limiting/validation
- `generatePeerId?: () => string` - Custom peer ID generator
- `logger?: Logger` - Logger instance (default: console)
- `onRoomCreated?: (roomId) => void` - Room creation hook
- `onRoomDestroyed?: (roomId) => void` - Room destruction hook
- `onPeerJoined?: (roomId, peerId) => void` - Peer joined hook
- `onPeerLeft?: (roomId, peerId) => void` - Peer left hook

**Methods:**
- `getStats(): ServerStats` - Get server statistics
- `getRooms(): RoomInfo[]` - Get all rooms
- `getRoom(roomId): RoomInfo | null` - Get specific room info
- `shutdown(): Promise<void>` - Graceful shutdown

**Static Methods:**
- `CollaborationServer.standalone(port, options): Promise<CollaborationServer>` - Create standalone server

#### Message Interceptor (Custom Rate Limiting)

```typescript
import { MessageInterceptor, MessageContext } from '@d-buckner/ensemble-collaboration/server';

class CustomRateLimiter implements MessageInterceptor {
  private requests = new Map<string, number[]>();

  async intercept(context: MessageContext): boolean {
    const key = context.socket.id;
    const now = Date.now();
    const window = 10000; // 10 seconds

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key)!;
    const recentRequests = timestamps.filter(t => now - t < window);

    if (recentRequests.length >= 100) {
      context.socket.emit('exception', {
        code: 429,
        message: 'Rate limit exceeded',
      });
      return false; // Block the message
    }

    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    return true; // Allow the message
  }
}

// Use it
const server = new CollaborationServer(io, {
  interceptor: new CustomRateLimiter(),
});
```

### Server Protocol

The server handles these Socket.IO events:

**Client → Server:**
- `join-room { roomId }` - Join a collaboration room
- `leave-room` - Leave current room
- `webrtc-signal { to, data }` - WebRTC signaling relay
- `sync-message { to, message }` - CRDT sync message (fallback transport)

**Server → Client:**
- `room-peers { peerId, peers }` - Room joined successfully with peer list
- `peer-joined peerId` - New peer joined room
- `peer-left peerId` - Peer left room
- `webrtc-signal { from, data }` - WebRTC signaling from peer
- `sync-message { from, message }` - CRDT message from peer

### Live Demo

A complete working React demo is available in `demos/react/collaboration/`:

- **Real-time collaborative todo list** - Multiple browser clients syncing in real-time
- **WebSocket transport** - Server-side message relay with room management
- **Automerge CRDT** - Automatic conflict resolution
- **Full TypeScript** - Type-safe collaboration with domain-specific actions

**Quick start:**
```bash
# From the collaboration package directory
npm run demo
```

This runs both the collaboration server and React demo client with colored output.

**Manual setup:**
```bash
# Terminal 1: Start the collaboration server
npm run demo:server

# Terminal 2: Start the React client (opens at http://localhost:5173)
npm run demo:client

# Open multiple browser tabs to see real-time sync
```

The demo shows how to:
- Extend `CollaborationActor` with domain-specific actions
- Set up WebSocket server with room management
- Configure actor dependencies and lifecycle
- Integrate with React for reactive UI updates
