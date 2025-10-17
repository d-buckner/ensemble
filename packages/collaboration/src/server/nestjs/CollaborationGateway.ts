/**
 * NestJS integration for CollaborationServer
 *
 * This file provides a NestJS Gateway that wraps CollaborationServer,
 * allowing users to apply NestJS decorators like @Throttle, @UseGuards, etc.
 *
 * @example
 * ```typescript
 * import { CollaborationGateway } from '@d-buckner/ensemble-collaboration/server';
 * import { Throttle } from '@nestjs/throttler';
 * import { UseGuards } from '@nestjs/common';
 *
 * @WebSocketGateway()
 * export class MyCollaborationGateway extends CollaborationGateway {
 *   @Throttle({ default: { limit: 100, ttl: 10000 } })
 *   @UseGuards(WsThrottlerGuard)
 *   @SubscribeMessage('join-room')
 *   async handleJoinRoom(client, data) {
 *     return super.handleJoinRoom(client, data);
 *   }
 * }
 * ```
 */

import { CollaborationServer } from '../CollaborationServer';
import type { CollaborationServerOptions } from '../types';
import type { Server as SocketIOServer, Socket } from 'socket.io';

/**
 * Base class for NestJS Gateway integration
 *
 * Users extend this class and apply their own decorators
 * (@Throttle, @UseGuards, etc.) to the handler methods.
 *
 * This class doesn't use decorators itself - that's left to the user's
 * subclass so they can customize rate limiting, validation, etc.
 */
export class CollaborationGateway {
  protected server!: SocketIOServer;
  protected collaboration!: CollaborationServer;
  protected options: CollaborationServerOptions;

  constructor(options: CollaborationServerOptions = {}) {
    this.options = options;
  }

  /**
   * Called by NestJS after the gateway is initialized with a server
   */
  afterInit(server: SocketIOServer): void {
    this.server = server;
    this.collaboration = new CollaborationServer(server, this.options);
  }

  /**
   * Handle join-room message
   * Override this in your subclass to add decorators
   */
  async handleJoinRoom(client: Socket, data: { roomId: string }): Promise<void> {
    return this.collaboration.handleJoinRoom(client, data);
  }

  /**
   * Handle leave-room message
   * Override this in your subclass to add decorators
   */
  async handleLeaveRoom(client: Socket): Promise<void> {
    return this.collaboration.handleLeaveRoom(client);
  }

  /**
   * Handle WebRTC signaling
   * Override this in your subclass to add decorators
   */
  async handleWebRTCSignal(client: Socket, data: { to: string; data: unknown }): Promise<void> {
    return this.collaboration.handleWebRTCSignal(client, data);
  }

  /**
   * Handle CRDT sync message
   * Override this in your subclass to add decorators
   */
  async handleSyncMessage(client: Socket, data: { to: string; message: number[] }): Promise<void> {
    return this.collaboration.handleSyncMessage(client, data);
  }

  /**
   * Get server statistics
   */
  getStats() {
    return this.collaboration.getStats();
  }

  /**
   * Get all rooms
   */
  getRooms() {
    return this.collaboration.getRooms();
  }

  /**
   * Get specific room info
   */
  getRoom(roomId: string) {
    return this.collaboration.getRoom(roomId);
  }
}
