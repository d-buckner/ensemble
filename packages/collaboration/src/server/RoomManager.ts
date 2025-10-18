import type { RoomInfo, Logger } from './types';

/**
 * RoomManager - Manages room and peer state for collaboration server
 *
 * Responsibilities:
 * - Track which peers are in which rooms
 * - Generate unique peer IDs
 * - Provide room statistics
 * - Clean up empty rooms
 */
export class RoomManager {
  private rooms = new Map<string, Set<string>>(); // roomId -> Set<peerId>
  private socketToPeer = new Map<string, string>(); // socketId -> peerId
  private peerToRoom = new Map<string, string>(); // peerId -> roomId
  private roomCreationTime = new Map<string, Date>(); // roomId -> creation time
  private generatePeerId: () => string;
  private logger: Logger;

  constructor(
    generatePeerId: () => string = () => crypto.randomUUID(),
    logger: Logger = console
  ) {
    this.generatePeerId = generatePeerId;
    this.logger = logger;
  }

  /**
   * Add a peer to a room.
   * Creates the room if it doesn't exist.
   * Returns the assigned peer ID.
   */
  addPeer(roomId: string, socketId: string): string {
    const peerId = this.generatePeerId();

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
      this.roomCreationTime.set(roomId, new Date());
      this.logger.info(`Room created: ${roomId}`);
    }

    // Add peer to room and track mappings
    this.rooms.get(roomId)!.add(peerId);
    this.socketToPeer.set(socketId, peerId);
    this.peerToRoom.set(peerId, roomId);

    this.logger.debug?.(`Peer ${peerId} joined room ${roomId} (socket: ${socketId})`);

    return peerId;
  }

  /**
   * Remove a peer from their room.
   * Returns the room ID and peer ID if the peer was in a room, null otherwise.
   * Cleans up empty rooms.
   */
  removePeer(socketId: string): { roomId: string; peerId: string } | null {
    const peerId = this.socketToPeer.get(socketId);
    if (!peerId) {
      return null;
    }

    const roomId = this.peerToRoom.get(peerId);
    if (!roomId) {
      return null;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    // Remove peer from room and clean up mappings
    room.delete(peerId);
    this.socketToPeer.delete(socketId);
    this.peerToRoom.delete(peerId);

    this.logger.debug?.(`Peer ${peerId} left room ${roomId} (socket: ${socketId})`);

    // Clean up empty room
    if (room.size === 0) {
      this.rooms.delete(roomId);
      this.roomCreationTime.delete(roomId);
      this.logger.info(`Room destroyed: ${roomId}`);
    }

    return { roomId, peerId };
  }

  /**
   * Get all peer IDs in a room
   */
  getPeersInRoom(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room) : [];
  }

  /**
   * Get the room ID for a socket
   */
  getRoomForSocket(socketId: string): string | null {
    const peerId = this.socketToPeer.get(socketId);
    if (!peerId) {
      return null;
    }
    return this.peerToRoom.get(peerId) || null;
  }

  /**
   * Get the peer ID for a socket
   */
  getPeerIdForSocket(socketId: string): string | null {
    return this.socketToPeer.get(socketId) || null;
  }

  /**
   * Check if a room exists
   */
  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Get all room IDs
   */
  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get information about a specific room
   */
  getRoomInfo(roomId: string): RoomInfo | null {
    const peers = this.rooms.get(roomId);
    const createdAt = this.roomCreationTime.get(roomId);

    if (!peers || !createdAt) {
      return null;
    }

    return {
      roomId,
      peerIds: Array.from(peers),
      createdAt,
    };
  }

  /**
   * Get all rooms with their information
   */
  getAllRooms(): RoomInfo[] {
    const rooms: RoomInfo[] = [];

    for (const roomId of this.rooms.keys()) {
      const info = this.getRoomInfo(roomId);
      if (info) {
        rooms.push(info);
      }
    }

    return rooms;
  }

  /**
   * Get server statistics
   */
  getStats() {
    let totalPeers = 0;
    const roomDetails: Array<{ roomId: string; peerCount: number }> = [];

    for (const [roomId, peers] of this.rooms) {
      totalPeers += peers.size;
      roomDetails.push({ roomId, peerCount: peers.size });
    }

    return {
      rooms: this.rooms.size,
      peers: totalPeers,
      roomDetails,
    };
  }

  /**
   * Clear all rooms and peers (for testing/cleanup)
   */
  clear(): void {
    this.rooms.clear();
    this.socketToPeer.clear();
    this.peerToRoom.clear();
    this.roomCreationTime.clear();
  }
}
