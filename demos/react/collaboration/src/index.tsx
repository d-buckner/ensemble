import { WebSocketActor, WebRTCActor, PeerMessagingActor } from '@d-buckner/ensemble-collaboration';
import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TodosActor } from './actors/TodosActor';
import { App } from './App';
import { WebSocketToken, WebRTCToken, PeerMessagingToken, TodosToken } from './tokens';


async function main() {
  const system = new ActorSystem();

  // Register WebSocket actor for server communication
  system.register({
    token: WebSocketToken,
    actor: WebSocketActor,
  });

  // Register WebRTC actor for peer-to-peer connections
  system.register({
    token: WebRTCToken,
    actor: WebRTCActor,
  });

  // Register PeerMessaging actor for peer tracking
  system.register({
    token: PeerMessagingToken,
    actor: PeerMessagingActor,
    dependencies: {
      websocket: WebSocketToken,
      webrtc: WebRTCToken
    }
  });

  // Register collaboration TodosActor
  system.register({
    token: TodosToken,
    actor: TodosActor,
    dependencies: { connection: PeerMessagingToken }
  });

  await system.start();

  // Initialize WebSocket configuration
  const websocket = system.getClient(WebSocketToken);
  if (websocket) {
    websocket.actions.initialize({
      url: 'http://localhost:3001',
      roomId: 'demo-room'
    });
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <EnsembleProvider system={system}>
        <App />
      </EnsembleProvider>
    </StrictMode>
  );

  (window as any).system = system;
}

main().catch(console.error);
