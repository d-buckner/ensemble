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

  describe('initialization', () => {
    it('should start with empty peer list', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      expect(client!.state.connectedPeers).toEqual([]);
      expect(client!.state.peerTransports).toEqual({});
    });
  });

  describe('message routing', () => {
    it('should handle sendTo action without throwing', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even if peer doesn't exist
      expect(() => client!.actions.sendTo('peer-1', message)).not.toThrow();
    });

    it('should handle broadcast action without throwing', () => {
      const client = system.getClient(PeerMessagingToken);
      expect(client).not.toBeNull();

      const message = new Uint8Array([1, 2, 3]);

      // Should not throw even with no peers
      expect(() => client!.actions.broadcast(message)).not.toThrow();
    });
  });
});
