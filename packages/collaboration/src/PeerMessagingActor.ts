import { Actor, action, effect, type IActorClient } from '@d-buckner/ensemble-core';
import type {
  PeerMessagingState,
  PeerMessagingEvents,
  MessagePayload,
  SignalingPayload,
} from './types';
import type { WebRTCActor } from './WebRTCActor';
import type { WebSocketActor } from './WebSocketActor';

/**
 * Dependencies for PeerMessagingActor
 */
export interface PeerMessagingDeps {
  websocket: IActorClient<WebSocketActor>;
  webrtc: IActorClient<WebRTCActor>;
}

/**
 * PeerMessagingActor - Central coordinator for peer connections and message routing
 *
 * Responsibilities:
 * - Tracks connected peers and their active transport (WebRTC or WebSocket)
 * - Routes outbound messages to the appropriate transport
 * - Normalizes inbound messages from both transports
 * - Coordinates WebRTC signaling between WebRTCActor and WebSocketActor
 * - Single source of truth for peer connectivity
 *
 * Key Features:
 * - Listens to both transport actors via effects (one-way, no circular dependency)
 * - Encapsulates routing logic with the state it depends on
 * - Provides normalized messageReceived event for CollaborationActor
 */
export class PeerMessagingActor extends Actor<PeerMessagingState, PeerMessagingEvents> {
  static readonly initialState: PeerMessagingState = {
    connectedPeers: [],
    peerTransports: {},
  };

  protected declare deps: PeerMessagingDeps;

  constructor() {
    super(PeerMessagingActor.initialState);
  }

  // ========================================
  // Actions: Message routing
  // ========================================

  /**
   * Send a message to a specific peer via the appropriate transport.
   * Automatically falls back to WebSocket if WebRTC not connected.
   *
   * @param peerId - ID of the peer to send to
   * @param message - Message payload (typically Automerge sync message)
   */
  @action
  sendTo(peerId: string, message: Uint8Array): void {
    const transport = this.state.peerTransports[peerId];

    if (!transport) {
      return;
    }

    // Check WebRTC connection state before attempting to use it
    if (transport === 'webrtc') {
      const webrtcState = this.deps.webrtc.state.peerConnectionStates[peerId];
      if (webrtcState === 'connected') {
        this.deps.webrtc.actions.sendTo(peerId, message);
        return;
      }
      // WebRTC not connected, fallback to WebSocket
      this.deps.websocket.actions.sendTo(peerId, message);
      return;
    }

    this.deps.websocket.actions.sendTo(peerId, message);
  }

  /**
   * Broadcast a message to all connected peers.
   *
   * @param message - Message payload to broadcast
   */
  @action
  broadcast(message: Uint8Array): void {
    for (const peerId of this.state.connectedPeers) {
      this.sendTo(peerId, message);
    }
  }

  // ========================================
  // Effects: WebSocket events
  // ========================================

  /**
   * Handle peer joined via WebSocket.
   * Adds peer to state with WebSocket transport and emits peerConnected.
   * Also initiates WebRTC connection as the initiator.
   */
  @effect('websocket.peerJoined')
  private handleWebSocketPeerJoined(peerId: string): void {
    if (this.state.connectedPeers.includes(peerId)) {
      return;
    }

    this.setState(draft => {
      draft.connectedPeers.push(peerId);
      draft.peerTransports[peerId] = 'websocket';
    });

    this.emit('peerConnected', peerId);

    // Initiate WebRTC connection
    this.deps.webrtc.actions.connectToPeer(peerId);
  }

  /**
   * Handle peer left via WebSocket.
   * Removes peer from state and emits peerDisconnected.
   * Also disconnects WebRTC connection.
   */
  @effect('websocket.peerLeft')
  private handleWebSocketPeerLeft(peerId: string): void {
    if (!this.state.connectedPeers.includes(peerId)) {
      return;
    }

    this.setState(draft => {
      draft.connectedPeers = draft.connectedPeers.filter(id => id !== peerId);
      delete draft.peerTransports[peerId];
    });

    // Disconnect WebRTC
    this.deps.webrtc.actions.disconnectPeer(peerId);

    this.emit('peerDisconnected', peerId);
  }

  /**
   * Handle WebSocket signaling message.
   * Forwards signaling data directly to WebRTCActor.
   */
  @effect('websocket.signalingMessage')
  private handleWebSocketSignaling(payload: SignalingPayload): void {
    this.deps.webrtc.actions.handleSignaling(payload);
  }

  /**
   * Handle WebSocket message received.
   * Normalizes and emits messageReceived event.
   * Self-healing: adds peer to state if not tracked yet.
   */
  @effect('websocket.messageReceived')
  private handleWebSocketMessage(payload: MessagePayload): void {
    // Self-healing: add peer if not tracked yet (race condition handling)
    if (!this.state.connectedPeers.includes(payload.peerId)) {
      this.setState(draft => {
        draft.connectedPeers.push(payload.peerId);
        draft.peerTransports[payload.peerId] = 'websocket';
      });
      this.emit('peerConnected', payload.peerId);
    }

    // Emit normalized message
    this.emit('messageReceived', payload);
  }

  // ========================================
  // Effects: WebRTC events
  // ========================================

  /**
   * Handle WebRTC peer connected.
   * Updates transport to WebRTC and emits transportChanged.
   */
  @effect('webrtc.peerConnected')
  private handleWebRTCPeerConnected(peerId: string): void {
    if (!this.state.connectedPeers.includes(peerId)) {
      return;
    }

    const previousTransport = this.state.peerTransports[peerId];

    this.setState(draft => {
      draft.peerTransports[peerId] = 'webrtc';
    });

    if (previousTransport !== 'webrtc') {
      this.emit('transportChanged', { peerId, transport: 'webrtc' });
    }
  }

  /**
   * Handle WebRTC peer disconnected.
   * Falls back to WebSocket transport and emits transportChanged.
   * Peer remains in the room - only transport changes.
   */
  @effect('webrtc.peerDisconnected')
  private handleWebRTCPeerDisconnected(peerId: string): void {
    if (!this.state.connectedPeers.includes(peerId)) {
      return;
    }

    const previousTransport = this.state.peerTransports[peerId];

    this.setState(draft => {
      draft.peerTransports[peerId] = 'websocket';
    });

    if (previousTransport !== 'websocket') {
      this.emit('transportChanged', { peerId, transport: 'websocket' });
    }
  }

  /**
   * Handle WebRTC signaling data.
   * Forwards to WebSocketActor for relay to peer.
   */
  @effect('webrtc.signalingData')
  private handleWebRTCSignaling(payload: SignalingPayload): void {
    this.deps.websocket.actions.sendSignal(payload.peerId, payload.data);
  }

  /**
   * Handle WebRTC message received.
   * Normalizes and emits messageReceived event.
   */
  @effect('webrtc.messageReceived')
  private handleWebRTCMessage(payload: MessagePayload): void {
    this.emit('messageReceived', payload);
  }
}
