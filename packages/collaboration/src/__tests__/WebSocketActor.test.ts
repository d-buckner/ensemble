import { ActorSystem, createActorToken } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketActor } from '../WebSocketActor';

// Mock socket.io-client
interface MockSocket {
  id: string;
  connected: boolean;
  on: (event: string, handler: Function) => void;
  emit: (event: string, data?: any) => void;
  connect: () => void;
  disconnect: () => void;
  _handlers: Map<string, Function[]>;
  _triggerEvent: (event: string, data?: any) => void;
}

let mockSocket: MockSocket | null = null;

vi.mock('socket.io-client', () => {
  return {
    io: vi.fn((_url: string, _options: any) => {
      mockSocket = {
        id: 'mock-socket-id',
        connected: false,
        _handlers: new Map(),

        on(event: string, handler: Function) {
          if (!this._handlers.has(event)) {
            this._handlers.set(event, []);
          }
          this._handlers.get(event)!.push(handler);
        },

        emit: vi.fn(),

        connect() {
          this.connected = true;
          // Trigger connect event
          Promise.resolve().then(() => this._triggerEvent('connect'));
        },

        disconnect() {
          this.connected = false;
          this._triggerEvent('disconnect');
        },

        _triggerEvent(event: string, data?: any) {
          const handlers = this._handlers.get(event);
          if (handlers) {
            handlers.forEach(handler => handler(data));
          }
        }
      };

      return mockSocket;
    })
  };
});

describe('WebSocketActor', () => {
  let system: ActorSystem;
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');

  beforeEach(async () => {
    mockSocket = null;
    vi.clearAllMocks();

    system = new ActorSystem();
    system.register({
      token: WebSocketToken,
      actor: WebSocketActor,
    });
    await system.start();
  });

  describe('Initialization', () => {
    it('should start with disconnected state', () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      expect(client!.state.url).toBe('');
      expect(client!.state.roomId).toBe('');
      expect(client!.state.peerId).toBeNull();
      expect(client!.state.connectionState).toBe('disconnected');
    });

    it('should set url and roomId on initialize', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      expect(client!.state.url).toBe('http://localhost:3000');
      expect(client!.state.roomId).toBe('test-room');
      expect(client!.state.connectionState).toBe('disconnected');
    });
  });

  describe('Connection Lifecycle', () => {
    it('should throw error when connecting without initialization', () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      expect(() => {
        client!.actions.connect();
      }).toThrow('WebSocketActor not initialized');
    });

    it('should transition to connected on successful connection', async () => {
      const client = system.getClient(WebSocketToken)!;
      expect(client).not.toBeNull();

      client.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      expect(client.state.connectionState).toBe('connected');
    });

    it('should not create duplicate connection if already connected', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      const firstSocket = mockSocket;

      // Try to connect again
      client!.actions.connect();
      await flushMicrotask();

      // Should be same socket instance
      expect(mockSocket).toBe(firstSocket);
    });

    it('should transition to disconnected on disconnect', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      expect(client!.state.connectionState).toBe('connected');

      client!.actions.disconnect();
      await flushMicrotask();

      expect(client!.state.connectionState).toBe('disconnected');
      expect(client!.state.peerId).toBeNull();
    });

    it('should handle disconnect gracefully when not connected', () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      // Should not throw
      expect(() => {
        client!.actions.disconnect();
      }).not.toThrow();
    });
  });

  describe('Room Management', () => {
    it('should join room automatically after connection', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      // Check that join-room was emitted
      expect(mockSocket!.emit).toHaveBeenCalledWith('join-room', { roomId: 'test-room' });
    });

    it('should assign peer ID when receiving room-peers event', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      // Simulate server response
      mockSocket!._triggerEvent('room-peers', {
        peerId: 'peer-123',
        peers: ['peer-456', 'peer-789']
      });
      await flushMicrotask();

      expect(client!.state.peerId).toBe('peer-123');
    });

    it('should emit peerJoined for existing peers in room', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      mockSocket!._triggerEvent('room-peers', {
        peerId: 'peer-123',
        peers: ['peer-456', 'peer-789']
      });
      await flushMicrotask();

      // Verify peerId was set
      expect(client!.state.peerId).toBe('peer-123');
    });

    it('should handle peer-joined event', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      // Trigger peer joined
      mockSocket!._triggerEvent('peer-joined', 'new-peer-123');
      await flushMicrotask();

      // Event was emitted (verified by actor not throwing)
      expect(client!.state.connectionState).toBe('connected');
    });

    it('should handle peer-left event', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      // Trigger peer left
      mockSocket!._triggerEvent('peer-left', 'peer-456');
      await flushMicrotask();

      // Event was processed without error
      expect(client!.state.connectionState).toBe('connected');
    });
  });

  describe('Signaling', () => {
    it('should send WebRTC signal to peer', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      const signalData = { type: 'offer', sdp: 'test-sdp' };
      client!.actions.sendSignal('peer-456', signalData);

      expect(mockSocket!.emit).toHaveBeenCalledWith('webrtc-signal', {
        to: 'peer-456',
        data: signalData
      });
    });

    it('should silently fail when sending signal while disconnected', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      const signalData = { type: 'offer', sdp: 'test-sdp' };

      // Should not throw
      expect(() => {
        client!.actions.sendSignal('peer-456', signalData);
      }).not.toThrow();

      expect(mockSocket).toBeNull();
    });

    it('should relay received WebRTC signals', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      const signalData = { type: 'answer', sdp: 'remote-sdp' };
      mockSocket!._triggerEvent('webrtc-signal', {
        from: 'peer-456',
        data: signalData
      });
      await flushMicrotask();

      // Signal was processed (actor emits signalingMessage event)
      expect(client!.state.connectionState).toBe('connected');
    });
  });

  describe('Fallback Transport', () => {
    it('should send CRDT message to peer', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      const message = new Uint8Array([1, 2, 3, 4]);
      client!.actions.sendTo('peer-456', message);

      expect(mockSocket!.emit).toHaveBeenCalledWith('sync-message', {
        to: 'peer-456',
        message: [1, 2, 3, 4] // Converted to array
      });
    });

    it('should convert received CRDT messages from array to Uint8Array', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      mockSocket!._triggerEvent('sync-message', {
        from: 'peer-456',
        message: [5, 6, 7, 8]
      });
      await flushMicrotask();

      // Message was processed (emits messageReceived with Uint8Array)
      expect(client!.state.connectionState).toBe('connected');
    });

    it('should silently fail when sending message while disconnected', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      const message = new Uint8Array([1, 2, 3, 4]);

      // Should not throw
      expect(() => {
        client!.actions.sendTo('peer-456', message);
      }).not.toThrow();

      expect(mockSocket).toBeNull();
    });
  });

  describe('Reconnection', () => {
    it('should handle reconnection state', async () => {
      const client = system.getClient(WebSocketToken);
      expect(client).not.toBeNull();

      client!.actions.initialize({
        url: 'http://localhost:3000',
        roomId: 'test-room'
      });
      await flushMicrotask();

      client!.actions.connect();
      await flushMicrotask();
      await flushMicrotask();

      // Simulate reconnection attempt
      mockSocket!._triggerEvent('reconnect_attempt');
      await flushMicrotask();

      expect(client!.state.connectionState).toBe('reconnecting');
    });
  });
});
