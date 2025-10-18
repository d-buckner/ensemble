# Collaboration Examples

This directory contains example applications demonstrating the `@d-buckner/ensemble-collaboration` package.

## Quick Start

The easiest way to run the demo is using the npm script that starts both server and client together:

```bash
npm run demo
```

This will:
1. Start the collaboration server on port 3001
2. Wait 2 seconds for the server to initialize
3. Run the client demo showing two peers collaborating in real-time

You'll see colored output with `[server]` in blue and `[client]` in green, making it easy to follow what's happening.

**Press Ctrl+C to stop both processes when done.**

## Running Examples Individually

If you prefer to run the server and client separately (for debugging or experimentation):

### Prerequisites

Make sure you have the package dependencies installed:

```bash
npm install
```

### Available Scripts

- `npm run demo` - Run both server and client together (recommended)
- `npm run demo:server` - Run only the server
- `npm run demo:client` - Run only the client (requires server to be running)

## Examples

### 1. Standalone Server (`standalone-server.ts`)

A basic collaboration server that handles:
- Room management
- Peer discovery
- WebRTC signaling
- CRDT message relay (WebSocket fallback)

**Features:**
- CORS enabled for all origins
- Lifecycle hooks for monitoring
- Graceful shutdown on Ctrl+C
- Real-time statistics logging

**Run:**
```bash
npm run demo:server
# or directly with tsx:
# tsx examples/standalone-server.ts
```

The server will start on port 3001 and display connection information.

### 2. Client Demo (`client-demo.ts`)

Demonstrates two collaboration clients syncing a shared todo list in real-time.

**Features:**
- Two clients in the same room
- Real-time state synchronization
- Automatic conflict resolution via Automerge
- WebSocket-only transport (simplified for demo)

**Demonstrated Operations:**
- Adding todos from different clients
- Toggling todo completion status
- Removing todos
- State verification across clients

**Run:**

First, start the server in one terminal:
```bash
npm run demo:server
```

Then run the client demo in another terminal:
```bash
npm run demo:client
```

**Expected Output:**
```
🚀 Starting Collaboration Demo
================================

Creating Client A...
Creating Client B...

[Client A] State updated:
  Todos (0):

[Client B] State updated:
  Todos (0):

📝 Starting collaborative edits...

→ Client A adds "Buy groceries"

[Client A] State updated:
  Todos (1):
    1. [ ] Buy groceries (clientA-1234567890)

[Client B] State updated:
  Todos (1):
    1. [ ] Buy groceries (clientA-1234567890)

...

✅ Final State Verification:
============================
Client A todos: 2
Client B todos: 2
States match: ✓ YES

🎉 Demo complete! Press Ctrl+C to exit.
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Collaboration Server                    │
│                   (Port 3001)                            │
│                                                           │
│  • Room Management                                       │
│  • Peer Discovery                                        │
│  • Message Routing                                       │
│  • WebRTC Signaling                                      │
└─────────────────────────────────────────────────────────┘
                    ↑                ↑
                    │                │
         WebSocket  │                │  WebSocket
                    │                │
       ┌────────────┴──┐       ┌────┴─────────────┐
       │   Client A    │       │    Client B      │
       │               │       │                  │
       │  TodosActor   │       │   TodosActor     │
       │  (Automerge   │←─────→│   (Automerge     │
       │   CRDT)       │ Sync  │    CRDT)         │
       └───────────────┘       └──────────────────┘
```

## Key Concepts

### CollaborationActor

The `TodosActor` extends `CollaborationActor<TodoDoc>` and provides:
- Domain-specific actions (addTodo, toggleTodo, removeTodo)
- Automatic CRDT synchronization
- Conflict-free concurrent editing

### PeerMessagingActor

Tracks connected peers and routes messages:
- Maintains list of connected peer IDs
- Routes messages to appropriate transport
- Emits events for peer lifecycle (connected, disconnected)

### WebSocketActor

Socket.IO client for server communication:
- Handles room join/leave
- Relays CRDT sync messages
- Manages WebRTC signaling (not used in demo)

## Extending the Examples

### Add WebRTC Support

To enable P2P WebRTC connections (lower latency):

1. Add WebRTCActor to the client setup
2. Install `simple-peer` package
3. Configure WebRTC in actor registration

```typescript
import SimplePeer from 'simple-peer';

const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

system.register({
  token: WebRTCToken,
  actor: WebRTCActor,
  dependencies: { peerMessaging: PeerMessagingToken }
});

system.register({
  token: PeerMessagingToken,
  actor: PeerMessagingActor,
  dependencies: {
    websocket: WebSocketToken,
    webrtc: WebRTCToken  // Add WebRTC dependency
  }
});
```

### Custom Rate Limiting

Add a custom MessageInterceptor to the server:

```typescript
import { MessageInterceptor, MessageContext } from '../src/server/index';

class RateLimiter implements MessageInterceptor {
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
        message: 'Rate limit exceeded'
      });
      return false; // Block message
    }

    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    return true; // Allow message
  }
}

const server = await CollaborationServer.standalone(3001, {
  logger: console,
  interceptor: new RateLimiter()
});
```

### Multiple Rooms

Modify the client demo to join different rooms:

```typescript
const clientA = await createClient('Client A', 'room-1');
const clientB = await createClient('Client B', 'room-1');
const clientC = await createClient('Client C', 'room-2');

// Client A and B will sync with each other
// Client C will be isolated in room-2
```

## Troubleshooting

### Server not starting

- Check that port 3001 is available
- Verify `socket.io` dependency is installed
- Look for error messages in server console

### Clients not syncing

- Ensure server is running before starting clients
- Check both clients join the same room ID
- Verify WebSocket connection in server logs
- Look for "peer-connected" events

### State mismatch

- Automerge CRDTs guarantee eventual consistency
- Allow time for sync messages to propagate
- Check network connectivity between clients and server

## Next Steps

- Add persistence to the server (Redis, database)
- Create a web UI with React
- Add authentication and authorization
- Implement presence awareness (cursor positions, user info)
- Add offline support with local-first architecture
