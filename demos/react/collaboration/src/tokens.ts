import { createActorToken } from '@d-buckner/ensemble-core';
import type { TodosActor } from './actors/TodosActor';
import type { WebSocketActor, PeerMessagingActor, WebRTCActor } from '@d-buckner/ensemble-collaboration';


export const WebSocketToken = createActorToken<WebSocketActor>('websocket');
export const WebRTCToken = createActorToken<WebRTCActor>('webrtc');
export const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
export const TodosToken = createActorToken<TodosActor>('todos');
