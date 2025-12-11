import { Actor, action } from '@d-buckner/ensemble-core';
import { io, type Socket } from 'socket.io-client';
import type {
  WebSocketState,
  WebSocketEvents,
  WebSocketConfig,
  WebSocketAuthConfig,
} from './types';
import type { SignalData } from '@d-buckner/peer-pressure';

export interface WebSocketActions {
  initialize(config: WebSocketConfig): void;
  connect(): void;
  disconnect(): void;
  sendSignal(peerId: string, data: unknown): void;
  sendTo(peerId: string, message: Uint8Array): void;
}

/**
 * WebSocketActor - Socket.IO client for signaling and fallback transport
 *
 * Responsibilities:
 * - WebRTC signaling transport (offers, answers, ICE candidates)
 * - Room management (join/leave, peer discovery)
 * - Fallback transport when WebRTC unavailable
 * - Connection state management
 *
 * Key Features:
 * - Socket.IO built-in reconnection
 * - Room-based peer discovery
 * - Server-assigned peer IDs (ensures uniqueness)
 * - No dependencies on other actors
 */
export class WebSocketActor extends Actor<WebSocketState, WebSocketActions, WebSocketEvents> {
  static readonly initialState: WebSocketState = {
    url: '',
    roomId: '',
    peerId: null,
    connectionState: 'disconnected',
    authConfig: null,
  };

  private socket: Socket | null = null;

  /**
   * Create a new WebSocketActor
   */
  constructor() {
    super(WebSocketActor.initialState);
  }

  /**
   * Initialize the WebSocket connection configuration.
   * Must be called before connect().
   *
   * @param config - Configuration with Socket.IO URL, room ID, and optional auth
   */
  @action
  initialize(config: WebSocketConfig): void {
    this.setState(draft => {
      draft.url = config.url;
      draft.roomId = config.roomId;
      draft.authConfig = config.authConfig ?? null;
    });
  }

  // ========================================
  // Actions: Connection management
  // ========================================

  /**
   * Connect to Socket.IO server and join room.
   * Server will assign a unique peer ID and return list of existing peers.
   *
   * Uses auth configuration if provided during initialize():
   * - withCredentials: Include cookies for session-based auth
   * - query: Custom query parameters (displayName, etc.)
   * - auth: Socket.IO auth payload (token-based auth)
   */
  @action
  connect(): void {
    if (this.socket) {
      return;
    }

    if (!this.state.url) {
      throw new Error('WebSocketActor not initialized. Call initialize() first.');
    }

    this.setState(draft => {
      draft.connectionState = 'connecting';
    });
    this.emit('connectionStateChanged', 'connecting');

    const authConfig = this.state.authConfig;
    this.socket = io(this.state.url, {
      autoConnect: false,
      withCredentials: authConfig?.withCredentials ?? false,
      query: authConfig?.query,
      auth: this.buildAuthPayload(authConfig),
    });

    this.setupSocketListeners();
    this.socket.connect();
  }

  /**
   * Build the auth payload for Socket.IO from auth config.
   */
  private buildAuthPayload(authConfig: WebSocketAuthConfig | null): Record<string, unknown> | undefined {
    if (!authConfig?.auth) {
      return undefined;
    }

    if (typeof authConfig.auth === 'string') {
      return { token: authConfig.auth };
    }

    return authConfig.auth;
  }

  /**
   * Leave the current room and disconnect from server.
   */
  @action
  disconnect(): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('leave-room', this.state.roomId);
    this.socket.disconnect();
    this.socket = null;

    this.setState(draft => {
      draft.peerId = null;
      draft.connectionState = 'disconnected';
    });
    this.emit('connectionStateChanged', 'disconnected');
  }

  // ========================================
  // Actions: Messaging
  // ========================================

  /**
   * Send WebRTC signaling data to a specific peer.
   *
   * @param peerId - ID of the peer to send signaling to
   * @param data - Signaling data (offer, answer, or ICE candidate)
   */
  @action
  sendSignal(peerId: string, data: unknown): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('webrtc-signal', {
      to: peerId,
      data,
    });
  }

  /**
   * Send a CRDT sync message to a specific peer (fallback transport).
   *
   * @param peerId - ID of the peer to send to
   * @param message - Message payload (Automerge sync message)
   */
  @action
  sendTo(peerId: string, message: Uint8Array): void {
    if (!this.socket?.connected) {
      console.warn('[WebSocketActor] ⚠️  Cannot send CRDT message - socket not connected');
      return;
    }

    console.log(`[WebSocketActor] 📤 Sending CRDT sync message to peer: ${peerId} (${message.length} bytes)`);

    this.socket.emit('sync-message', {
      to: peerId,
      message: Array.from(message), // Convert Uint8Array to regular array for JSON serialization
    });
  }

  // ========================================
  // Private: Socket.IO event handlers
  // ========================================

  private setupSocketListeners(): void {
    if (!this.socket) {
      return;
    }

    // Connection events
    this.socket.on('connect', () => {
      this.setState(draft => {
        draft.connectionState = 'connected';
      });
      this.emit('connectionStateChanged', 'connected');

      // Join room after connection
      this.socket!.emit('join-room', { roomId: this.state.roomId });
    });

    this.socket.on('disconnect', () => {
      this.setState(draft => {
        draft.connectionState = 'disconnected';
      });
      this.emit('connectionStateChanged', 'disconnected');
    });

    this.socket.on('reconnect_attempt', () => {
      this.setState(draft => {
        draft.connectionState = 'reconnecting';
      });
      this.emit('connectionStateChanged', 'reconnecting');
    });

    // Room events
    this.socket.on('room-peers', (data: { peerId: string; peers: string[] }) => {
      // Server assigned peer ID
      this.setState(draft => {
        draft.peerId = data.peerId;
      });

      this.emit('roomJoined', {
        roomId: this.state.roomId,
        peerId: data.peerId,
        peerIds: data.peers,
      });
    });

    this.socket.on('peer-joined', (peerId: string) => {
      this.emit('peerJoined', peerId);
    });

    this.socket.on('peer-left', (peerId: string) => {
      this.emit('peerLeft', peerId);
    });

    // WebRTC signaling
    this.socket.on('webrtc-signal', (data: { from: string; data: SignalData }) => {
      this.emit('signalingMessage', {
        peerId: data.from,
        data: data.data,
      });
    });

    // CRDT messages (fallback transport)
    this.socket.on('sync-message', (data: { from: string; message: number[] }) => {
      // Convert array back to Uint8Array
      const message = new Uint8Array(data.message);
      console.log(`[WebSocketActor] 📥 Received CRDT sync message from peer: ${data.from} (${message.length} bytes)`);
      this.emit('messageReceived', {
        peerId: data.from,
        message,
      });
    });

    // Error handling
    this.socket.on('connect_error', (error: Error & { data?: unknown }) => {
      console.error('[WebSocketActor] Connection error:', error.message);
      this.emit('connectionError', { message: error.message, data: error.data });
      this.throw('Socket.IO connection error', { error: error.message });
    });

    this.socket.on('error', (error: unknown) => {
      console.error('[WebSocketActor] Server error:', error);
    });
  }

  // ========================================
  // Lifecycle
  // ========================================

  public override async onDestroy(): Promise<void> {
    this.disconnect();
  }
}
