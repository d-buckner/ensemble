import { ActorSystem, createActorToken } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebRTCActor } from '../WebRTCActor';
import type { SignalData } from '@d-buckner/peer-pressure';


// Mock peer-pressure
vi.mock('@d-buckner/peer-pressure', () => {
  return {
    default: class MockPeer {
      private handlers = new Map<string, Function[]>();
      public initiator: boolean;

      constructor(config: { initiator: boolean }) {
        this.initiator = config.initiator;

        // Connect immediately - we're testing actor behavior, not WebRTC timing
        Promise.resolve().then(() => this.emit('connect'));
      }

      on(event: string, handler: Function) {
        if (!this.handlers.has(event)) {
          this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
      }

      emit(event: string, ...args: any[]) {
        const handlers = this.handlers.get(event);
        if (handlers) {
          handlers.forEach(handler => handler(...args));
        }
      }

      signal() {
        // When we receive a signal, immediately generate a response signal
        const responseType = this.initiator ? 'answer' : 'offer';
        this.emit('signal', { type: responseType, sdp: 'mock-sdp' });
      }

      send() {
        // Simulate successful send
      }

      destroy() {
        // Only emit close once to avoid infinite loop
        if (!this._destroyed) {
          this._destroyed = true;
          this.emit('close');
        }
      }

      private _destroyed = false;
    }
  };
});


describe('WebRTCActor', () => {
  let system: ActorSystem;
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

    system.register({
      token: WebRTCToken,
      actor: WebRTCActor,
    });

    await system.start();
  });

  describe('Signaling Flow', () => {
    it('should start with empty peer connection states', () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();
      expect(client!.state.peerConnectionStates).toEqual({});
    });

    it('should create initiator peer when connectToPeer called', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');

      // Wait for state update and connection
      await flushMicrotask();
      await flushMicrotask();

      // Peer should eventually be connected
      expect(client!.state.peerConnectionStates['peer-1']).toBeDefined();
    });

    it('should not create duplicate peer if already exists', () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      const initialState = client!.state.peerConnectionStates['peer-1'];

      // Try to connect again
      client!.actions.connectToPeer('peer-1');

      // State should remain unchanged
      expect(client!.state.peerConnectionStates['peer-1']).toBe(initialState);
    });

    it('should create non-initiator peer when receiving first signal', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      const mockSignal: SignalData = {
        type: 'offer',
        sdp: 'mock-offer-sdp'
      };

      client!.actions.handleSignaling({
        peerId: 'peer-1',
        data: mockSignal
      });

      // Wait for connection to complete
      await flushMicrotask();
      await flushMicrotask();

      // Peer should be created and tracked
      expect(client!.state.peerConnectionStates['peer-1']).toBeDefined();
    });

    it('should forward signals to existing peer', () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      // Create peer first
      client!.actions.connectToPeer('peer-1');

      const mockSignal: SignalData = {
        type: 'answer',
        sdp: 'mock-answer-sdp'
      };

      // Should not throw when signaling existing peer
      expect(() => {
        client!.actions.handleSignaling({
          peerId: 'peer-1',
          data: mockSignal
        });
      }).not.toThrow();
    });

    it('should handle multiple signals without error', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();

      // Send multiple signals - should not throw
      const mockSignal: SignalData = {
        type: 'answer',
        sdp: 'mock-answer-sdp'
      };

      expect(() => {
        client!.actions.handleSignaling({ peerId: 'peer-1', data: mockSignal });
        client!.actions.handleSignaling({ peerId: 'peer-1', data: mockSignal });
      }).not.toThrow();
    });

    it('should connect peer successfully', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');

      // Wait for connection to complete
      await flushMicrotask();
      await flushMicrotask();

      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');
    });

    it('should track multiple connection state transitions', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      // Connect
      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();
      await flushMicrotask();
      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');

      // Disconnect
      client!.actions.disconnectPeer('peer-1');
      await flushMicrotask();
      expect(client!.state.peerConnectionStates['peer-1']).toBeUndefined();

      // Reconnect
      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();
      await flushMicrotask();
      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');
    });

    it('should clean up peer on disconnectPeer action', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      // Wait for connection to complete
      await flushMicrotask();
      await flushMicrotask();

      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');

      client!.actions.disconnectPeer('peer-1');
      await flushMicrotask();

      expect(client!.state.peerConnectionStates['peer-1']).toBeUndefined();
    });

    it('should remove peer from state on disconnect', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();
      await flushMicrotask();

      // Peer should be connected
      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');

      client!.actions.disconnectPeer('peer-1');
      await flushMicrotask();

      // Peer should be removed from state
      expect(client!.state.peerConnectionStates['peer-1']).toBeUndefined();
    });
  });

  describe('Messaging', () => {
    it('should send data via connected peer', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();
      await flushMicrotask();

      const message = new Uint8Array([1, 2, 3, 4]);

      // Should not throw when peer is connected
      expect(() => {
        client!.actions.sendTo('peer-1', message);
      }).not.toThrow();
    });

    it('should silently fail when sending to non-existent peer', () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      const message = new Uint8Array([1, 2, 3, 4]);

      // Should not throw even if peer doesn't exist
      expect(() => {
        client!.actions.sendTo('non-existent-peer', message);
      }).not.toThrow();
    });

    it('should silently fail when sending to disconnected peer', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      await flushMicrotask();
      await flushMicrotask();

      client!.actions.disconnectPeer('peer-1');
      await flushMicrotask();

      const message = new Uint8Array([1, 2, 3, 4]);

      // Should not throw even after disconnect
      expect(() => {
        client!.actions.sendTo('peer-1', message);
      }).not.toThrow();
    });
  });

  describe('Multiple Peers', () => {
    it('should handle multiple concurrent peer connections', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      client!.actions.connectToPeer('peer-2');
      client!.actions.connectToPeer('peer-3');

      // Wait for all connections to complete
      await flushMicrotask();
      await flushMicrotask();

      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');
      expect(client!.state.peerConnectionStates['peer-2']).toBe('connected');
      expect(client!.state.peerConnectionStates['peer-3']).toBe('connected');
    });

    it('should maintain separate state for each peer', async () => {
      const client = system.getClient(WebRTCToken);
      expect(client).not.toBeNull();

      client!.actions.connectToPeer('peer-1');
      client!.actions.connectToPeer('peer-2');

      await flushMicrotask();
      await flushMicrotask();

      // Verify peers are connected
      expect(client!.state.peerConnectionStates['peer-1']).toBe('connected');
      expect(client!.state.peerConnectionStates['peer-2']).toBe('connected');

      // Disconnect one
      client!.actions.disconnectPeer('peer-1');
      await flushMicrotask();

      // Only peer-1 should be removed
      expect(client!.state.peerConnectionStates['peer-1']).toBeUndefined();
      expect(client!.state.peerConnectionStates['peer-2']).toBe('connected');
    });
  });
});
