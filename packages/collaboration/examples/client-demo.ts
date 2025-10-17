/**
 * Client Collaboration Demo
 *
 * This example demonstrates how to create collaboration clients that sync
 * via the CollaborationServer.
 *
 * Prerequisites:
 * 1. Start the standalone server: `tsx examples/standalone-server.ts`
 * 2. Run this client demo: `tsx examples/client-demo.ts`
 *
 * This will create two clients in the same room and demonstrate real-time
 * collaboration with automatic conflict resolution via Automerge CRDTs.
 */

import 'reflect-metadata';
import { createActorToken, ActorSystem, action } from '@d-buckner/ensemble-core';
import { CollaborationActor, PeerMessagingActor, WebSocketActor } from '../src/index';

// Define document type
interface TodoDoc {
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// Extend CollaborationActor with domain actions
class TodosActor extends CollaborationActor<TodoDoc> {
  static readonly initialState: TodoDoc = {
    todos: []
  };

  constructor() {
    super(TodosActor.initialState);
  }

  @action
  addTodo(text: string): void {
    this.setState(draft => {
      draft.todos.push({
        id: `${this.peerId}-${Date.now()}`,
        text,
        done: false
      });
    });
  }

  @action
  toggleTodo(id: string): void {
    this.setState(draft => {
      const todo = draft.todos.find(t => t.id === id);
      if (todo) {
        todo.done = !todo.done;
      }
    });
  }

  @action
  removeTodo(id: string): void {
    this.setState(draft => {
      const index = draft.todos.findIndex(t => t.id === id);
      if (index !== -1) {
        draft.todos.splice(index, 1);
      }
    });
  }

  // Expose peer ID for identifying client
  get peerId(): string {
    return this.deps.connection?.state?.connectedPeers?.[0] || 'unknown';
  }
}

// Create actor tokens
const WebSocketToken = createActorToken<WebSocketActor>('websocket');
const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
const TodosToken = createActorToken<TodosActor>('todos');

/**
 * Create a client system with collaboration actors
 */
async function createClient(clientName: string, roomId: string): Promise<ActorSystem> {
  const system = new ActorSystem();

  // Register WebSocket actor for server communication
  system.register({
    token: WebSocketToken,
    actor: WebSocketActor,
    constructorParams: {
      url: 'http://localhost:3001',
      roomId
    }
  });

  // Register PeerMessaging actor for peer tracking
  system.register({
    token: PeerMessagingToken,
    actor: PeerMessagingActor,
    dependencies: { websocket: WebSocketToken }
  });

  // Register collaboration TodosActor
  system.register({
    token: TodosToken,
    actor: TodosActor,
    dependencies: { connection: PeerMessagingToken }
  });

  await system.start();

  // Subscribe to state changes
  const todos = system.get(TodosToken);
  todos.subscribe((state) => {
    console.log(`\n[${clientName}] State updated:`);
    console.log(`  Todos (${state.todos.length}):`);
    state.todos.forEach((todo, index) => {
      const status = todo.done ? '✓' : ' ';
      console.log(`    ${index + 1}. [${status}] ${todo.text} (${todo.id})`);
    });
  });

  // Connect to server
  const websocket = system.get(WebSocketToken);
  websocket.actions.connect();

  return system;
}

/**
 * Simulate collaborative editing between two clients
 */
async function runDemo() {
  console.log('🚀 Starting Collaboration Demo');
  console.log('================================\n');

  const ROOM_ID = 'demo-room';

  // Create two clients
  console.log('Creating Client A...');
  const clientA = await createClient('Client A', ROOM_ID);

  console.log('Creating Client B...');
  const clientB = await createClient('Client B', ROOM_ID);

  // Wait for connections to establish
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\n📝 Starting collaboration edits...\n');

  // Get actor instances
  const todosA = clientA.get(TodosToken);
  const todosB = clientB.get(TodosToken);

  // Client A adds todos
  console.log('→ Client A adds "Buy groceries"');
  todosA.actions.addTodo('Buy groceries');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Client B adds todos
  console.log('→ Client B adds "Walk the dog"');
  todosB.actions.addTodo('Walk the dog');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Client A adds another
  console.log('→ Client A adds "Read a book"');
  todosA.actions.addTodo('Read a book');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Client B toggles a todo
  const firstTodoId = todosB.state.todos[0]?.id;
  if (firstTodoId) {
    console.log(`→ Client B completes todo: ${firstTodoId}`);
    todosB.actions.toggleTodo(firstTodoId);
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  // Client A removes a todo
  const lastTodoId = todosA.state.todos[todosA.state.todos.length - 1]?.id;
  if (lastTodoId) {
    console.log(`→ Client A removes todo: ${lastTodoId}`);
    todosA.actions.removeTodo(lastTodoId);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify both clients have consistent state
  console.log('\n✅ Final State Verification:');
  console.log('============================');
  console.log(`Client A todos: ${todosA.state.todos.length}`);
  console.log(`Client B todos: ${todosB.state.todos.length}`);

  const statesMatch = JSON.stringify(todosA.state) === JSON.stringify(todosB.state);
  console.log(`States match: ${statesMatch ? '✓ YES' : '✗ NO'}`);

  if (!statesMatch) {
    console.log('\nClient A state:', JSON.stringify(todosA.state, null, 2));
    console.log('\nClient B state:', JSON.stringify(todosB.state, null, 2));
  }

  console.log('\n🎉 Demo complete! Press Ctrl+C to exit.\n');
}

// Run the demo
runDemo().catch(console.error);
