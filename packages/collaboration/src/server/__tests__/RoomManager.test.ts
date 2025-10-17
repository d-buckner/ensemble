import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../RoomManager';


describe('RoomManager', () => {
  let roomManager: RoomManager;
  let peerIdCounter = 0;

  beforeEach(() => {
    peerIdCounter = 0;
    roomManager = new RoomManager(
      () => `peer-${peerIdCounter++}`, // Counter-based ID generator for tests
      { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } // Silent logger
    );
  });

  describe('addPeer', () => {
    it('should add a peer to a room', () => {
      const peerId = roomManager.addPeer('room1', 'socket1');

      expect(peerId).toBeDefined();
      expect(peerId).toMatch(/^peer-/);

      const peers = roomManager.getPeersInRoom('room1');
      expect(peers).toHaveLength(1);
      expect(peers[0]).toBe(peerId);
    });

    it('should create room if it does not exist', () => {
      roomManager.addPeer('room1', 'socket1');

      expect(roomManager.hasRoom('room1')).toBe(true);
    });

    it('should add multiple peers to same room', () => {
      const peer1 = roomManager.addPeer('room1', 'socket1');
      const peer2 = roomManager.addPeer('room1', 'socket2');

      const peers = roomManager.getPeersInRoom('room1');
      expect(peers).toHaveLength(2);
      expect(peers).toContain(peer1);
      expect(peers).toContain(peer2);
    });

    it('should support multiple rooms', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.addPeer('room2', 'socket2');

      expect(roomManager.hasRoom('room1')).toBe(true);
      expect(roomManager.hasRoom('room2')).toBe(true);
      expect(roomManager.getAllRoomIds()).toHaveLength(2);
    });
  });

  describe('removePeer', () => {
    it('should remove a peer from a room', () => {
      const peerId = roomManager.addPeer('room1', 'socket1');

      const result = roomManager.removePeer('socket1');

      expect(result).not.toBeNull();
      expect(result?.roomId).toBe('room1');
      expect(result?.peerId).toBe(peerId);

      const peers = roomManager.getPeersInRoom('room1');
      expect(peers).toHaveLength(0);
    });

    it('should return null if socket not in a room', () => {
      const result = roomManager.removePeer('non-existent-socket');

      expect(result).toBeNull();
    });

    it('should destroy empty rooms', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.removePeer('socket1');

      expect(roomManager.hasRoom('room1')).toBe(false);
    });

    it('should not destroy room if peers remain', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.addPeer('room1', 'socket2');

      roomManager.removePeer('socket1');

      expect(roomManager.hasRoom('room1')).toBe(true);
      expect(roomManager.getPeersInRoom('room1')).toHaveLength(1);
    });
  });

  describe('getPeersInRoom', () => {
    it('should return empty array for non-existent room', () => {
      const peers = roomManager.getPeersInRoom('non-existent');

      expect(peers).toEqual([]);
    });

    it('should return all peers in a room', () => {
      const peer1 = roomManager.addPeer('room1', 'socket1');
      const peer2 = roomManager.addPeer('room1', 'socket2');
      const peer3 = roomManager.addPeer('room1', 'socket3');

      const peers = roomManager.getPeersInRoom('room1');

      expect(peers).toHaveLength(3);
      expect(peers).toContain(peer1);
      expect(peers).toContain(peer2);
      expect(peers).toContain(peer3);
    });
  });

  describe('getRoomForSocket', () => {
    it('should return room ID for a socket', () => {
      roomManager.addPeer('room1', 'socket1');

      const roomId = roomManager.getRoomForSocket('socket1');

      expect(roomId).toBe('room1');
    });

    it('should return null for socket not in a room', () => {
      const roomId = roomManager.getRoomForSocket('non-existent');

      expect(roomId).toBeNull();
    });
  });

  describe('getRoomInfo', () => {
    it('should return room information', () => {
      const peer1 = roomManager.addPeer('room1', 'socket1');
      const peer2 = roomManager.addPeer('room1', 'socket2');

      const info = roomManager.getRoomInfo('room1');

      expect(info).not.toBeNull();
      expect(info?.roomId).toBe('room1');
      expect(info?.peerIds).toHaveLength(2);
      expect(info?.peerIds).toContain(peer1);
      expect(info?.peerIds).toContain(peer2);
      expect(info?.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent room', () => {
      const info = roomManager.getRoomInfo('non-existent');

      expect(info).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.addPeer('room1', 'socket2');
      roomManager.addPeer('room2', 'socket3');

      const stats = roomManager.getStats();

      expect(stats.rooms).toBe(2);
      expect(stats.peers).toBe(3);
      expect(stats.roomDetails).toHaveLength(2);

      const room1Detail = stats.roomDetails.find(r => r.roomId === 'room1');
      expect(room1Detail?.peerCount).toBe(2);

      const room2Detail = stats.roomDetails.find(r => r.roomId === 'room2');
      expect(room2Detail?.peerCount).toBe(1);
    });

    it('should return empty stats for no rooms', () => {
      const stats = roomManager.getStats();

      expect(stats.rooms).toBe(0);
      expect(stats.peers).toBe(0);
      expect(stats.roomDetails).toHaveLength(0);
    });
  });

  describe('getAllRooms', () => {
    it('should return all room information', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.addPeer('room2', 'socket2');

      const rooms = roomManager.getAllRooms();

      expect(rooms).toHaveLength(2);
      expect(rooms.map(r => r.roomId).sort()).toEqual(['room1', 'room2']);
    });

    it('should return empty array when no rooms', () => {
      const rooms = roomManager.getAllRooms();

      expect(rooms).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all rooms and peers', () => {
      roomManager.addPeer('room1', 'socket1');
      roomManager.addPeer('room2', 'socket2');

      roomManager.clear();

      expect(roomManager.getAllRoomIds()).toHaveLength(0);
      expect(roomManager.getStats().rooms).toBe(0);
      expect(roomManager.getStats().peers).toBe(0);
    });
  });
});
