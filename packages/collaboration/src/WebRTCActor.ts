import { Actor, action } from '@d-buckner/ensemble-core';
import Peer from '@d-buckner/peer-pressure';
import type {
  WebRTCState,
  WebRTCEvents,
  SignalingPayload,
} from './types';
import type { SignalData } from '@d-buckner/peer-pressure';

/**
 * WebRTCActor has no dependencies - it's a pure transport layer
 * PeerMessagingActor coordinates by calling its actions
 */


/**
 * WebRTCActor - WebRTC P2P transport using peer-pressure
 *
 * Responsibilities:
 * - Manages WebRTC peer connections via data channels
 * - Handles WebRTC signaling coordination via PeerMessagingActor
 * - Sends/receives CRDT messages over P2P connections
 * - Full-mesh topology: connects to every other peer
 *
 * Key Features:
 * - Deterministic initiator selection (lexicographic peer ID comparison)
 * - Effect-driven: listens to PeerMessagingActor for peer lifecycle and signaling
 * - Fully decoupled from WebSocketActor (signaling coordinated via PeerMessagingActor)
 * - Throws error if sendTo() called on disconnected peer (PeerMessagingActor handles fallback)
 */
export class WebRTCActor extends Actor<WebRTCState, WebRTCEvents> {
  static readonly initialState: WebRTCState = {
    peerConnectionStates: {},
  };

  private peers = new Map<string, Peer>();

  /**
   * Create a new WebRTCActor
   */
  constructor() {
    super(WebRTCActor.initialState);
  }

  // ========================================
  // Actions: Messaging
  // ========================================

  /**
   * Send a message to a specific peer via WebRTC data channel.
   * Silently fails if peer not connected (caller should check state first).
   *
   * @param peerId - ID of the peer to send to
   * @param message - Message payload (Automerge sync message)
   */
  @action
  sendTo(peerId: string, message: Uint8Array): void {
    const peer = this.peers.get(peerId);
    const state = this.state.peerConnectionStates[peerId];

    if (!peer || state !== 'connected') {
      // Silently fail - PeerMessagingActor checks state before calling
      return;
    }

    peer.send(message);
  }

  // ========================================
  // Actions: Peer connection management (called by PeerMessagingActor)
  // ========================================

  /**
   * Create a WebRTC peer connection to a specific peer as the initiator.
   * Called by PeerMessagingActor when a new peer joins the room.
   *
   * The initiator creates the offer and starts the WebRTC handshake.
   *
   * @param peerId - ID of the peer to connect to
   */
  @action
  connectToPeer(peerId: string): void {
    if (this.peers.has(peerId)) {
      return;
    }

    this.setState(draft => {
      draft.peerConnectionStates[peerId] = 'connecting';
    });

    const peer = new Peer({ initiator: true });
    this.peers.set(peerId, peer);
    this.setupPeerListeners(peerId, peer);
  }

  /**
   * Handle incoming WebRTC signaling data for a peer.
   * Called by PeerMessagingActor when signaling is received from server.
   *
   * If we don't have a peer yet, this is the first signal (offer) from the initiator,
   * so we create a non-initiator peer to respond.
   *
   * @param payload - Signaling payload with peer ID and signaling data
   */
  @action
  handleSignaling(payload: SignalingPayload): void {
    let peer = this.peers.get(payload.peerId);

    // If we don't have a peer yet, we're the non-initiator responding to an offer
    if (!peer) {
      this.setState(draft => {
        draft.peerConnectionStates[payload.peerId] = 'connecting';
      });

      peer = new Peer({ initiator: false });
      this.peers.set(payload.peerId, peer);
      this.setupPeerListeners(payload.peerId, peer);
    }

    peer.signal(payload.data);
  }

  /**
   * Disconnect from a specific peer.
   * Called by PeerMessagingActor when peer leaves.
   *
   * @param peerId - ID of the peer to disconnect from
   */
  @action
  disconnectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(peerId);
    }

    this.setState(draft => {
      delete draft.peerConnectionStates[peerId];
    });
  }

  // ========================================
  // Private: Peer event handlers
  // ========================================

  private setupPeerListeners(peerId: string, peer: Peer): void {
    // Signaling data generated - needs to be sent to peer via WebSocket
    peer.on('signal', (data: SignalData) => {
      this.emit('signalingData', { peerId, data });
    });

    // WebRTC data channel connected
    peer.on('connect', () => {
      this.setState(draft => {
        draft.peerConnectionStates[peerId] = 'connected';
      });
      this.emit('peerConnected', peerId);
    });

    // Data received from peer
    peer.on('data', (data: Uint8Array) => {
      this.emit('messageReceived', { peerId, message: data });
    });

    // Connection closed
    peer.on('close', () => {
      console.log(`[WebRTCActor] 🔌 WebRTC connection closed for peer: ${peerId}`);
      this.handlePeerConnectionClosed(peerId);
    });

    // Connection error
    peer.on('error', (error: Error) => {
      console.error(`[WebRTCActor] ❌ WebRTC error for peer ${peerId}:`, error);
      this.setState(draft => {
        draft.peerConnectionStates[peerId] = 'failed';
      });
      this.handlePeerConnectionClosed(peerId);
    });
  }

  private handlePeerConnectionClosed(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(peerId);
    }

    this.setState(draft => {
      delete draft.peerConnectionStates[peerId];
    });

    this.emit('peerDisconnected', peerId);
  }

  // ========================================
  // Lifecycle
  // ========================================

  public override async onDestroy(): Promise<void> {
    // Clean up all peer connections
    for (const peer of this.peers.values()) {
      peer.destroy();
    }
    this.peers.clear();
  }
}
