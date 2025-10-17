/**
 * @d-buckner/ensemble-collaboration/server
 *
 * Server-side collaboration package for Socket.IO-based collaboration.
 *
 * Framework-agnostic design:
 * - Works with Express, NestJS, standalone servers, etc.
 * - User controls Socket.IO configuration (CORS, transports, etc.)
 * - Optional message interceptors for rate limiting, validation, etc.
 *
 * @example Express Integration
 * ```typescript
 * import { CollaborationServer } from '@d-buckner/ensemble-collaboration/server';
 * import { Server } from 'socket.io';
 * import express from 'express';
 * import { createServer } from 'http';
 *
 * const app = express();
 * const httpServer = createServer(app);
 * const io = new Server(httpServer, { cors: { origin: '*' } });
 *
 * const collaboration = new CollaborationServer(io, {
 *   onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`)
 * });
 *
 * httpServer.listen(3000);
 * ```
 *
 * @example NestJS Integration
 * ```typescript
 * import { CollaborationGateway } from '@d-buckner/ensemble-collaboration/server';
 * import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';
 * import { Throttle } from '@nestjs/throttler';
 * import { UseGuards } from '@nestjs/common';
 *
 * @WebSocketGateway()
 * export class MyGateway extends CollaborationGateway {
 *   @Throttle({ default: { limit: 100, ttl: 10000 } })
 *   @UseGuards(WsThrottlerGuard)
 *   @SubscribeMessage('join-room')
 *   async handleJoinRoom(client, data) {
 *     return super.handleJoinRoom(client, data);
 *   }
 * }
 * ```
 *
 * @example Standalone Server
 * ```typescript
 * import { CollaborationServer } from '@d-buckner/ensemble-collaboration/server';
 *
 * const server = CollaborationServer.standalone(3000, {
 *   logger: console,
 *   onPeerJoined: (room, peer) => console.log(`${peer} joined ${room}`)
 * });
 * ```
 */

// Core server
export { CollaborationServer } from './CollaborationServer';
export { RoomManager } from './RoomManager';

// NestJS integration
export { CollaborationGateway } from './nestjs/CollaborationGateway';

// Types
export type {
  CollaborationServerOptions,
  MessageContext,
  MessageInterceptor,
  Logger,
  ServerStats,
  RoomInfo,
} from './types';
