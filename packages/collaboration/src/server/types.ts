import type { Socket } from 'socket.io';

/**
 * Context provided to message interceptors
 */
export interface MessageContext {
  /** Socket instance for the connection */
  socket: Socket;
  /** Event name being processed */
  event: string;
  /** Message payload */
  payload: any;
  /** Room ID if available */
  roomId?: string;
  /** Peer ID if available */
  peerId?: string;
}

/**
 * Message interceptor for custom validation, rate limiting, etc.
 */
export interface MessageInterceptor {
  /**
   * Intercept a message before processing.
   * Return true to allow, false to block.
   */
  intercept(context: MessageContext): boolean | Promise<boolean>;
}

/**
 * Logger interface for server logging
 */
export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug?(message: string, meta?: any): void;
}

/**
 * Options for CollaborationServer
 */
export interface CollaborationServerOptions {
  /**
   * Message interceptor for rate limiting, validation, etc.
   * Called before processing each message.
   */
  interceptor?: MessageInterceptor;

  /**
   * Custom peer ID generator.
   * Default: generates random UUIDs
   */
  generatePeerId?: () => string;

  /**
   * Logger instance for server logs.
   * Default: console
   */
  logger?: Logger;

  /**
   * Hook called when a room is created
   */
  onRoomCreated?: (roomId: string) => void;

  /**
   * Hook called when a room is destroyed
   */
  onRoomDestroyed?: (roomId: string) => void;

  /**
   * Hook called when a peer joins a room
   */
  onPeerJoined?: (roomId: string, peerId: string) => void;

  /**
   * Hook called when a peer leaves a room
   */
  onPeerLeft?: (roomId: string, peerId: string) => void;
}

/**
 * Server statistics
 */
export interface ServerStats {
  /** Total number of active rooms */
  rooms: number;
  /** Total number of connected peers */
  peers: number;
  /** Rooms with peer counts */
  roomDetails?: Array<{ roomId: string; peerCount: number }>;
}

/**
 * Room information
 */
export interface RoomInfo {
  /** Room ID */
  roomId: string;
  /** Peer IDs in the room */
  peerIds: string[];
  /** Creation timestamp */
  createdAt: Date;
}
