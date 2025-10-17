import { ActorSystem, createActorToken, action } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach } from 'vitest';
import { CollaborationActor } from '../CollaborationActor';
import { PeerMessagingActor } from '../PeerMessagingActor';

// Test document type
interface TodoDoc {
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// Test actor that extends CollaborationActor
class TodosActor extends CollaborationActor<TodoDoc> {
  static readonly initialState: TodoDoc = {
    todos: [],
  };

  constructor() {
    super(TodosActor.initialState);
  }

  @action
  addTodo(text: string): void {
    this.setState(draft => {
      draft.todos.push({
        id: `todo-${Date.now()}`,
        text,
        done: false,
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
}

describe('CollaborationActor', () => {
  let system: ActorSystem;

  const TodosToken = createActorToken<TodosActor>('todos');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');

  beforeEach(async () => {
    system = new ActorSystem();

    system.register({
      token: PeerMessagingToken,
      actor: PeerMessagingActor,
    });

    system.register({
      token: TodosToken,
      actor: TodosActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  describe('setState override', () => {
    it('should initialize with empty todos', () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();
      expect(client!.state.todos).toEqual([]);
    });

    it('should update state via Automerge', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      expect(client!.state.todos).toHaveLength(0);

      client!.actions.addTodo('Test task');

      // Wait for state update to process
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(client!.state.todos).toHaveLength(1);
      expect(client!.state.todos[0].text).toBe('Test task');
      expect(client!.state.todos[0].done).toBe(false);
    });

    it('should handle multiple state updates', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Task 1');
      client!.actions.addTodo('Task 2');
      client!.actions.addTodo('Task 3');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(client!.state.todos).toHaveLength(3);
      expect(client!.state.todos.map(t => t.text)).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should handle mutations to existing items', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Test task');
      await new Promise(resolve => setTimeout(resolve, 10));

      const todoId = client!.state.todos[0].id;
      expect(client!.state.todos[0].done).toBe(false);

      client!.actions.toggleTodo(todoId);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(client!.state.todos[0].done).toBe(true);
    });

    it('should handle item removal', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Task 1');
      client!.actions.addTodo('Task 2');
      await new Promise(resolve => setTimeout(resolve, 10));

      const todoId = client!.state.todos[0].id;
      client!.actions.removeTodo(todoId);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(client!.state.todos).toHaveLength(1);
      expect(client!.state.todos[0].text).toBe('Task 2');
    });
  });

  describe('document as state pattern', () => {
    it('should expose document directly as state (no wrapper)', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Test');
      await new Promise(resolve => setTimeout(resolve, 10));

      // State IS the document
      expect(client!.state.todos).toBeDefined();
      expect(Array.isArray(client!.state.todos)).toBe(true);

      // NOT wrapped like state.document.todos
      expect((client!.state as any).document).toBeUndefined();
    });
  });
});
