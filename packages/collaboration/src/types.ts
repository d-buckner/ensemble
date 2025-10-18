/**
 * Core types for the collaboration package
 */

import type { SignalData } from '@d-buckner/peer-pressure';

// ============================================================================
// PeerMessagingActor Types
// ============================================================================

export type TransportType = 'webrtc' | 'websocket';

export interface PeerMessagingState {
  connectedPeers: string[];
  peerTransports: Record<string, TransportType>;
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

export interface PeerMessagingEvents {
  peerConnected: string;
  peerDisconnected: string;
  transportChanged: TransportChangedPayload;
  messageReceived: MessagePayload;
  signalingReceived: SignalingPayload;
}

// ============================================================================
// WebSocketActor Types
// ============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WebSocketConfig {
  url: string;
  roomId: string;
}

export interface WebSocketState {
  url: string;
  roomId: string;
  peerId: string | null;
  connectionState: ConnectionState;
}

export interface RoomJoinedPayload {
  roomId: string;
  peerId: string;
  peerIds: string[];
}

export interface WebSocketEvents {
  roomJoined: RoomJoinedPayload;
  peerJoined: string;
  peerLeft: string;
  signalingMessage: SignalingPayload;
  messageReceived: MessagePayload;
  connectionStateChanged: ConnectionState;
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
