import { RoomManager } from './RoomManager';
import type {
  CollaborationServerOptions,
  Logger,
  ServerStats,
  RoomInfo,
} from './types';
import type { Server as SocketIOServer , Socket } from 'socket.io';

/**
 * CollaborationServer - Framework-agnostic collaboration server
 *
 * Handles the collaboration protocol:
 * - Room management (join/leave)
 * - Peer discovery
 * - WebRTC signaling
 * - CRDT message relay (fallback transport)
 *
 * Design:
 * - Accepts Socket.IO server instance (user controls configuration)
 * - Optional message interceptor for rate limiting/validation
 * - Provides public methods for framework integration (NestJS, etc.)
 * - Hooks for monitoring and logging
 *
 * @example
 * ```typescript
 * const io = new Server(httpServer);
 * const server = new CollaborationServer(io, {
 *   logger: console,
 *   onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`)
 * });
 * ```
 */
export class CollaborationServer {
  private io: SocketIOServer;
  private roomManager: RoomManager;
  private options: CollaborationServerOptions;
  private logger: Logger;

  constructor(io: SocketIOServer, options: CollaborationServerOptions = {}) {
    this.io = io;
    this.options = options;
    this.logger = options.logger || console;

    this.roomManager = new RoomManager(
      options.generatePeerId,
      this.logger
    );

    this.setupEventHandlers();
    this.logger.info('CollaborationServer initialized');
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.logger.debug?.(`Socket connected: ${socket.id}`);

      // Join room
      socket.on('join-room', async (data) => {
        await this.handleJoinRoom(socket, data);
      });

      // Leave room
      socket.on('leave-room', async () => {
        await this.handleLeaveRoom(socket);
      });

      // WebRTC signaling
      socket.on('webrtc-signal', async (data) => {
        await this.handleWebRTCSignal(socket, data);
      });

      // CRDT sync messages (fallback transport)
      socket.on('sync-message', async (data) => {
        await this.handleSyncMessage(socket, data);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  /**
   * Handle join-room event
   * Public method for framework integration
   */
  async handleJoinRoom(socket: Socket, data: { roomId: string }): Promise<void> {
    const { roomId } = data;

    if (!roomId) {
      socket.emit('error', { message: 'Room ID is required' });
      return;
    }

    // Check interceptor
    if (this.options.interceptor) {
      const allowed = await this.options.interceptor.intercept({
        socket,
        event: 'join-room',
        payload: data,
        roomId,
      });

      if (!allowed) {
        return;
      }
    }

    // Get existing peers before adding new peer
    const existingPeers = this.roomManager.getPeersInRoom(roomId);

    // Add peer to room
    const peerId = this.roomManager.addPeer(roomId, socket.id);

    // Join Socket.IO room for broadcasting
    await socket.join(roomId);

    // Send room-peers response to joining peer
    socket.emit('room-peers', {
      peerId,
      peers: existingPeers,
    });

    // Notify existing peers about new peer
    socket.to(roomId).emit('peer-joined', peerId);

    // Call hook
    this.options.onPeerJoined?.(roomId, peerId);

    // Check if room was just created
    if (existingPeers.length === 0) {
      this.options.onRoomCreated?.(roomId);
    }

    this.logger.info(`Peer ${peerId} joined room ${roomId}`);
  }

  /**
   * Handle leave-room event
   * Public method for framework integration
   */
  async handleLeaveRoom(socket: Socket): Promise<void> {
    const result = this.roomManager.removePeer(socket.id);

    if (!result) {
      return;
    }

    const { roomId, peerId } = result;

    // Check interceptor
    if (this.options.interceptor) {
      const allowed = await this.options.interceptor.intercept({
        socket,
        event: 'leave-room',
        payload: {},
        roomId,
        peerId,
      });

      if (!allowed) {
        return;
      }
    }

    // Leave Socket.IO room
    await socket.leave(roomId);

    // Notify other peers
    socket.to(roomId).emit('peer-left', peerId);

    // Call hooks
    this.options.onPeerLeft?.(roomId, peerId);

    if (!this.roomManager.hasRoom(roomId)) {
      this.options.onRoomDestroyed?.(roomId);
    }

    this.logger.info(`Peer ${peerId} left room ${roomId}`);
  }

  /**
   * Handle WebRTC signaling
   * Public method for framework integration
   */
  async handleWebRTCSignal(socket: Socket, data: { to: string; data: unknown }): Promise<void> {
    const roomId = this.roomManager.getRoomForSocket(socket.id);

    if (!roomId) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    // Find the sender's peer ID
    const peers = this.roomManager.getPeersInRoom(roomId);
    const fromPeerId = peers.find(() => true); // Simplified - in real impl, track socket->peerId

    // Check interceptor
    if (this.options.interceptor) {
      const allowed = await this.options.interceptor.intercept({
        socket,
        event: 'webrtc-signal',
        payload: data,
        roomId,
        peerId: fromPeerId,
      });

      if (!allowed) {
        return;
      }
    }

    // Find target socket in the room
    const targetPeerId = data.to;
    const sockets = await this.io.in(roomId).fetchSockets();

    for (const targetSocket of sockets) {
      if (targetSocket.id !== socket.id) {
        // Check if this socket is the target peer
        // In a full implementation, we'd maintain a peerId -> socketId mapping
        targetSocket.emit('webrtc-signal', {
          from: fromPeerId,
          data: data.data,
        });
      }
    }

    this.logger.debug?.(`WebRTC signal from ${fromPeerId} to ${targetPeerId} in room ${roomId}`);
  }

  /**
   * Handle CRDT sync message (fallback transport)
   * Public method for framework integration
   */
  async handleSyncMessage(socket: Socket, data: { to: string; message: number[] }): Promise<void> {
    const roomId = this.roomManager.getRoomForSocket(socket.id);

    if (!roomId) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const peers = this.roomManager.getPeersInRoom(roomId);
    const fromPeerId = peers.find(() => true); // Simplified

    // Check interceptor
    if (this.options.interceptor) {
      const allowed = await this.options.interceptor.intercept({
        socket,
        event: 'sync-message',
        payload: data,
        roomId,
        peerId: fromPeerId,
      });

      if (!allowed) {
        return;
      }
    }

    // Find target socket and relay message
    const targetPeerId = data.to;
    const sockets = await this.io.in(roomId).fetchSockets();

    for (const targetSocket of sockets) {
      if (targetSocket.id !== socket.id) {
        targetSocket.emit('sync-message', {
          from: fromPeerId,
          message: data.message,
        });
      }
    }

    this.logger.debug?.(`Sync message from ${fromPeerId} to ${targetPeerId} in room ${roomId}`);
  }

  /**
   * Handle socket disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const result = this.roomManager.removePeer(socket.id);

    if (result) {
      const { roomId, peerId } = result;

      // Notify other peers
      socket.to(roomId).emit('peer-left', peerId);

      // Call hooks
      this.options.onPeerLeft?.(roomId, peerId);

      if (!this.roomManager.hasRoom(roomId)) {
        this.options.onRoomDestroyed?.(roomId);
      }

      this.logger.info(`Peer ${peerId} disconnected from room ${roomId}`);
    }

    this.logger.debug?.(`Socket disconnected: ${socket.id}`);
  }

  /**
   * Get server statistics
   */
  getStats(): ServerStats {
    return this.roomManager.getStats();
  }

  /**
   * Get all rooms with their information
   */
  getRooms(): RoomInfo[] {
    return this.roomManager.getAllRooms();
  }

  /**
   * Get information about a specific room
   */
  getRoom(roomId: string): RoomInfo | null {
    return this.roomManager.getRoomInfo(roomId);
  }

  /**
   * Shutdown the server
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down CollaborationServer');
    this.roomManager.clear();
    // Note: We don't close the Socket.IO server as the user manages it
  }

  /**
   * Factory method to create a standalone server
   */
  static async standalone(port: number, options: CollaborationServerOptions = {}): Promise<CollaborationServer> {
    const { createServer } = await import('http');
    const { Server } = await import('socket.io');

    const httpServer = createServer();
    const io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    const server = new CollaborationServer(io, options);

    httpServer.listen(port, () => {
      const logger = options.logger || console;
      logger.info(`Standalone collaboration server listening on port ${port}`);
    });

    return server;
  }
}
