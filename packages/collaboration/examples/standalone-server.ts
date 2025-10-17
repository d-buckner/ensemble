/**
 * Standalone Collaboration Server Example
 *
 * This example demonstrates how to create a standalone collaboration server
 * using the CollaborationServer class.
 *
 * Run with: tsx examples/standalone-server.ts
 */

import { CollaborationServer } from '../src/server/index';


const PORT = 3001;

// Create standalone server with hooks for logging
const server = await CollaborationServer.standalone(PORT, {
  logger: console,

  onRoomCreated: (roomId) => {
    console.log(`✨ Room created: ${roomId}`);
  },

  onRoomDestroyed: (roomId) => {
    console.log(`🗑️  Room destroyed: ${roomId}`);
  },

  onPeerJoined: (roomId, peerId) => {
    console.log(`👋 Peer ${peerId} joined room ${roomId}`);
    console.log('   Stats:', server.getStats());
  },

  onPeerLeft: (roomId, peerId) => {
    console.log(`👋 Peer ${peerId} left room ${roomId}`);
    console.log('   Stats:', server.getStats());
  },
});

console.log(`
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  🚀 Collaboration Server Running                        │
│                                                         │
│  Port: ${PORT}                                             │
│  URL:  http://localhost:${PORT}                            │
│                                                         │
│  Ready for WebSocket connections!                      │
│                                                         │
└─────────────────────────────────────────────────────────┘

Supported events:
  • join-room    - Join a collaboration room
  • leave-room   - Leave the current room
  • webrtc-signal - WebRTC signaling relay
  • sync-message  - CRDT sync message relay (fallback)

Press Ctrl+C to shutdown
`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down server...');
  await server.shutdown();
  process.exit(0);
});
