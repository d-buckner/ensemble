import { ActorSystem, createActorToken } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach } from 'vitest';
import { PeerMessagingActor } from '../PeerMessagingActor';
import { WebRTCActor } from '../WebRTCActor';
import { WebSocketActor } from '../WebSocketActor';


describe('PeerMessagingActor', () => {
  let system: ActorSystem;

  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

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
      dependencies: { websocket: WebSocketToken, webrtc: WebRTCToken },
    });

    await system.start();
  });

  describe('Initialization', () => {
    it('should start with empty peer list', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      expect(client!.state.connectedPeers).toEqual([]);
      expect(client!.state.peerTransports).toEqual({});
    });
  });

  describe('Message Routing', () => {
    it('should handle sendTo action without throwing', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even if peer doesn't exist
      expect(() => client!.actions.sendTo('peer-1', message)).not.toThrow();
    });

    it('should handle sendTo for unknown peer gracefully', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even if peer doesn't exist
      expect(() => client.actions.sendTo('unknown-peer', message)).not.toThrow();
    });

    it('should handle broadcast action without throwing', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even with no peers
      expect(() => client!.actions.broadcast(message)).not.toThrow();
    });

    it('should handle broadcast with no peers gracefully', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even with no peers
      expect(() => client.actions.broadcast(message)).not.toThrow();
    });

    it('should accept Uint8Array messages in sendTo', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([1, 2, 3, 4, 5]);

      expect(() => client.actions.sendTo('peer-1', message)).not.toThrow();
    });

    it('should accept Uint8Array messages in broadcast', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([100, 200]);

      expect(() => client.actions.broadcast(message)).not.toThrow();
    });
  });

  describe('State Management', () => {
    it('should maintain connectedPeers as an array', () => {
      const client = system.getClient(PeerMessagingToken)!;

      expect(Array.isArray(client.state.connectedPeers)).toBe(true);
    });

    it('should maintain peerTransports as an object', () => {
      const client = system.getClient(PeerMessagingToken)!;

      expect(typeof client.state.peerTransports).toBe('object');
      expect(client.state.peerTransports).not.toBeNull();
    });

    it('should have empty state after initialization', () => {
      const client = system.getClient(PeerMessagingToken)!;

      expect(client.state.connectedPeers.length).toBe(0);
      expect(Object.keys(client.state.peerTransports).length).toBe(0);
    });
  });

  describe('Dependency Integration', () => {
    it('should be registered with WebSocket dependency', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      // Verify it was able to start with dependencies
      expect(client!.state).toBeDefined();
    });

    it('should be registered with WebRTC dependency', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      // Verify it was able to start with dependencies
      expect(client!.state).toBeDefined();
    });

    it('should function when both dependencies are available', () => {
      const messaging = system.getClient(PeerMessagingToken)!;
      const websocket = system.getClient(WebSocketToken)!;
      const webrtc = system.getClient(WebRTCToken)!;

      expect(messaging).not.toBeNull();
      expect(websocket).not.toBeNull();
      expect(webrtc).not.toBeNull();

      // Should be able to call actions without errors
      const message = new Uint8Array([1, 2, 3]);
      expect(() => messaging.actions.sendTo('peer-1', message)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle sendTo with empty peerId gracefully', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([1, 2, 3]);

      expect(() => client.actions.sendTo('', message)).not.toThrow();
    });

    it('should handle sendTo with empty message gracefully', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([]);

      expect(() => client.actions.sendTo('peer-1', message)).not.toThrow();
    });

    it('should handle broadcast with empty message gracefully', () => {
      const client = system.getClient(PeerMessagingToken)!;
      const message = new Uint8Array([]);

      expect(() => client.actions.broadcast(message)).not.toThrow();
    });
  });
});
