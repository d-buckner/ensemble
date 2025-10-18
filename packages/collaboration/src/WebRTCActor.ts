import { Actor, action } from '@d-buckner/ensemble-core';
import type {
  WebRTCState,
  WebRTCEvents,
  SignalingPayload,
} from './types';

/**
 * Simple peer interface (compatible with simple-peer library)
 * This provides a type-safe interface for WebRTC peer connections
 */
interface SimplePeer {
  on(event: 'signal', handler: (data: unknown) => void): void;
  on(event: 'connect', handler: () => void): void;
  on(event: 'data', handler: (data: Uint8Array) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  signal(data: unknown): void;
  send(data: Uint8Array): void;
  destroy(): void;
}

/**
 * SimplePeer constructor interface
 */
interface SimplePeerConstructor {
  new (config: { initiator: boolean }): SimplePeer;
}

/**
 * WebRTCActor has no dependencies - it's a pure transport layer
 * PeerMessagingActor coordinates by calling its actions
 */

/**
 * Configuration for WebRTCActor
 */
export interface WebRTCConfig {
  /**
   * SimplePeer constructor (or compatible library like peer-pressure)
   * Must be provided as peer libraries typically don't work in server-side contexts
   */
  SimplePeer: SimplePeerConstructor;

  /**
   * Peer ID for this client (assigned by server)
   */
  peerId: string;
}

/**
 * WebRTCActor - WebRTC P2P transport using simple-peer (or peer-pressure)
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

  private peers = new Map<string, SimplePeer>();
  private SimplePeer: SimplePeerConstructor | null = null;
  private peerId: string = '';

  /**
   * Create a new WebRTCActor
   */
  constructor() {
    super(WebRTCActor.initialState);
  }

  /**
   * Initialize the WebRTC configuration.
   * Must be called before any peer connections are established.
   *
   * @param config - Configuration with SimplePeer constructor and peer ID
   */
  @action
  initialize(config: WebRTCConfig): void {
    this.SimplePeer = config.SimplePeer;
    this.peerId = config.peerId;
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
   * Create a WebRTC peer connection to a specific peer.
   * Called by PeerMessagingActor when a new peer joins.
   * Uses lexicographic comparison to determine initiator.
   *
   * @param peerId - ID of the peer to connect to
   */
  @action
  connectToPeer(peerId: string): void {
    if (!this.SimplePeer || !this.peerId) {
      return;
    }

    if (this.peers.has(peerId)) {
      return;
    }

    // Deterministic initiator selection: lexicographic comparison
    const isInitiator = this.peerId < peerId;

    this.setState(draft => {
      draft.peerConnectionStates[peerId] = 'connecting';
    });

    const peer = new this.SimplePeer({ initiator: isInitiator });
    this.peers.set(peerId, peer);
    this.setupPeerListeners(peerId, peer);
  }

  /**
   * Handle incoming WebRTC signaling data for a peer.
   * Called by PeerMessagingActor when signaling is received from server.
   *
   * @param payload - Signaling payload with peer ID and signaling data
   */
  @action
  handleSignaling(payload: SignalingPayload): void {
    const peer = this.peers.get(payload.peerId);
    if (!peer) {
      return;
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

  private setupPeerListeners(peerId: string, peer: SimplePeer): void {
    // Signaling data generated - needs to be sent to peer via WebSocket
    peer.on('signal', (data: unknown) => {
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
      this.handlePeerConnectionClosed(peerId);
    });

    // Connection error
    peer.on('error', (_error: Error) => {
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
