/**
 * @d-buckner/ensemble-collaboration
 *
 * Collaboration CRDT package for the Ensemble actor framework.
 * Provides real-time collaboration capabilities using Automerge CRDTs
 * with WebRTC P2P and WebSocket fallback transports.
 */

// Core actors
export { CollaborationActor, type CollaborationDeps } from './CollaborationActor';
export { PeerMessagingActor, type PeerMessagingDeps } from './PeerMessagingActor';
export { WebSocketActor } from './WebSocketActor';
export { WebRTCActor } from './WebRTCActor';

// Types
export type {
  // PeerMessaging types
  TransportType,
  PeerMetadata,
  PeerMessagingState,
  PeerMessagingEvents,
  MessagePayload,
  SignalingPayload,
  TransportChangedPayload,
  MetadataChangedPayload,

  // WebSocket types
  ConnectionState,
  WebSocketConfig,
  WebSocketAuthConfig,
  WebSocketState,
  WebSocketEvents,
  RoomJoinedPayload,
  ConnectionErrorPayload,

  // WebRTC types
  PeerConnectionState,
  WebRTCState,
  WebRTCEvents,

  // Collaboration types
  CollaborationEvents,

  // Automerge types (re-exported for convenience)
  AutomergeDoc,
  SyncState,
} from './types';
