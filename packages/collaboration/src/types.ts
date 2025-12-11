/**
 * Core types for the collaboration package
 */

import type { SignalData } from '@d-buckner/peer-pressure';

// ============================================================================
// PeerMessagingActor Types
// ============================================================================

export type TransportType = 'webrtc' | 'websocket';

/**
 * Metadata associated with a peer.
 * Applications can store any data here (displayName, instrument, color, etc.)
 */
export type PeerMetadata = Record<string, unknown>;

export interface PeerMessagingState {
  connectedPeers: string[];
  peerTransports: Record<string, TransportType>;
  peerMetadata: Record<string, PeerMetadata>;
  localMetadata: PeerMetadata | null;
}

export interface MessagePayload {
  peerId: string;
  message: Uint8Array;
}

export interface SignalingPayload {
  peerId: string;
  data: SignalData;
}

export interface TransportChangedPayload {
  peerId: string;
  transport: TransportType;
}

export interface MetadataChangedPayload {
  peerId: string;
  metadata: PeerMetadata;
}

export interface PeerMessagingEvents {
  roomJoined: RoomJoinedPayload;
  peerConnected: string;
  peerDisconnected: string;
  transportChanged: TransportChangedPayload;
  metadataChanged: MetadataChangedPayload;
  messageReceived: MessagePayload;
  signalingReceived: SignalingPayload;
}

// ============================================================================
// WebSocketActor Types
// ============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Authentication configuration for WebSocket connections.
 */
export interface WebSocketAuthConfig {
  /**
   * Include credentials (cookies) with the request.
   * Required for session-based authentication.
   */
  withCredentials?: boolean;

  /**
   * Custom query parameters to send on connection.
   * Useful for passing roomId, displayName, etc.
   */
  query?: Record<string, string>;

  /**
   * Auth payload for Socket.IO's auth option.
   * Can be a token string or an object with auth data.
   */
  auth?: string | Record<string, unknown>;
}

export interface WebSocketConfig {
  url: string;
  roomId: string;
  /**
   * Authentication configuration for the WebSocket connection.
   */
  authConfig?: WebSocketAuthConfig;
}

export interface WebSocketState {
  url: string;
  roomId: string;
  peerId: string | null;
  connectionState: ConnectionState;
  authConfig: WebSocketAuthConfig | null;
}

export interface RoomJoinedPayload {
  roomId: string;
  peerId: string;
  peerIds: string[];
}

export interface ConnectionErrorPayload {
  message: string;
  data?: unknown;
}

export interface WebSocketEvents {
  roomJoined: RoomJoinedPayload;
  peerJoined: string;
  peerLeft: string;
  signalingMessage: SignalingPayload;
  messageReceived: MessagePayload;
  connectionStateChanged: ConnectionState;
  connectionError: ConnectionErrorPayload;
}

// ============================================================================
// WebRTCActor Types
// ============================================================================

export type PeerConnectionState = 'connecting' | 'connected' | 'failed';

export interface WebRTCState {
  peerConnectionStates: Record<string, PeerConnectionState>;
}

export interface WebRTCEvents {
  peerConnected: string;
  peerDisconnected: string;
  messageReceived: MessagePayload;
  signalingData: SignalingPayload;
}

// ============================================================================
// CollaborationActor Types
// ============================================================================

export interface CollaborationEvents {
  // No custom events needed - uses PeerMessagingActor for all peer communication
}

// ============================================================================
// Automerge Types (re-export from @automerge/automerge for convenience)
// ============================================================================

// These will be imported from @automerge/automerge in the implementation files
export type { Doc as AutomergeDoc, SyncState } from '@automerge/automerge';
