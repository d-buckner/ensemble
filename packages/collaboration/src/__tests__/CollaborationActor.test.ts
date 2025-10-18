import { ActorSystem, createActorToken, action } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach } from 'vitest';
import { CollaborationActor } from '../CollaborationActor';
import { PeerMessagingActor } from '../PeerMessagingActor';
import { WebRTCActor } from '../WebRTCActor';
import { WebSocketActor } from '../WebSocketActor';

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

// Test document with nested structure
interface NestedDoc {
  users: {
    [key: string]: {
      name: string;
      profile: {
        age: number;
        tags: string[];
      };
    };
  };
}

class NestedActor extends CollaborationActor<NestedDoc> {
  static readonly initialState: NestedDoc = {
    users: {},
  };

  constructor() {
    super(NestedActor.initialState);
  }

  @action
  addUser(id: string, name: string, age: number): void {
    this.setState(draft => {
      draft.users[id] = {
        name,
        profile: { age, tags: [] },
      };
    });
  }

  @action
  addTag(userId: string, tag: string): void {
    this.setState(draft => {
      const user = draft.users[userId];
      if (user) {
        user.profile.tags.push(tag);
      }
    });
  }
}

describe('CollaborationActor', () => {
  let system: ActorSystem;

  const TodosToken = createActorToken<TodosActor>('todos');
  const NestedToken = createActorToken<NestedActor>('nested');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

    // Set up full actor hierarchy for integration
    system.register({
      token: WebSocketToken,
      actor: WebSocketActor,
    });

    system.register({
      token: WebRTCToken,
      actor: WebRTCActor,
    });

    system.register({
      token: PeerMessagingToken,
      actor: PeerMessagingActor,
      dependencies: { websocket: WebSocketToken, webrtc: WebRTCToken },
    });

    system.register({
      token: TodosToken,
      actor: TodosActor,
      dependencies: { connection: PeerMessagingToken },
    });

    system.register({
      token: NestedToken,
      actor: NestedActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  describe('Initialization', () => {
    it('should initialize with empty todos', () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();
      expect(client!.state.todos).toEqual([]);
    });

    it('should initialize with empty nested structure', () => {
      const client = system.getClient(NestedToken);
      expect(client).not.toBeNull();
      expect(client!.state.users).toEqual({});
    });

    it('should have state directly as document (no wrapper)', () => {
      const client = system.getClient(TodosToken)!;

      // State IS the document
      expect(client.state.todos).toBeDefined();
      expect((client.state as any).document).toBeUndefined();
    });
  });

  describe('State Updates via Automerge', () => {
    it('should update state via Automerge', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      expect(client!.state.todos).toHaveLength(0);

      client!.actions.addTodo('Test task');
      await flushMicrotask();

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

      await flushMicrotask();

      expect(client!.state.todos).toHaveLength(3);
      expect(client!.state.todos.map(t => t.text)).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should handle mutations to existing items', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Test task');
      await flushMicrotask();

      const todoId = client!.state.todos[0].id;
      expect(client!.state.todos[0].done).toBe(false);

      client!.actions.toggleTodo(todoId);
      await flushMicrotask();

      expect(client!.state.todos[0].done).toBe(true);
    });

    it('should handle item removal', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Task 1');
      client!.actions.addTodo('Task 2');
      await flushMicrotask();

      const todoId = client!.state.todos[0].id;
      client!.actions.removeTodo(todoId);
      await flushMicrotask();

      expect(client!.state.todos).toHaveLength(1);
      expect(client!.state.todos[0].text).toBe('Task 2');
    });

    it('should handle toggling same item multiple times', async () => {
      const client = system.getClient(TodosToken)!;

      client.actions.addTodo('Toggle test');
      await flushMicrotask();

      const todoId = client.state.todos[0].id;

      client.actions.toggleTodo(todoId);
      await flushMicrotask();
      expect(client.state.todos[0].done).toBe(true);

      client.actions.toggleTodo(todoId);
      await flushMicrotask();
      expect(client.state.todos[0].done).toBe(false);

      client.actions.toggleTodo(todoId);
      await flushMicrotask();
      expect(client.state.todos[0].done).toBe(true);
    });
  });

  describe('Nested Structure Support', () => {
    it('should handle nested object updates', async () => {
      const client = system.getClient(NestedToken)!;

      client.actions.addUser('user-1', 'Alice', 25);
      await flushMicrotask();

      expect(client.state.users['user-1']).toBeDefined();
      expect(client.state.users['user-1'].name).toBe('Alice');
      expect(client.state.users['user-1'].profile.age).toBe(25);
      expect(client.state.users['user-1'].profile.tags).toEqual([]);
    });

    it('should handle nested array updates', async () => {
      const client = system.getClient(NestedToken)!;

      client.actions.addUser('user-1', 'Bob', 30);
      await flushMicrotask();

      client.actions.addTag('user-1', 'developer');
      client.actions.addTag('user-1', 'typescript');
      await flushMicrotask();

      expect(client.state.users['user-1'].profile.tags).toEqual(['developer', 'typescript']);
    });

    it('should handle multiple nested users', async () => {
      const client = system.getClient(NestedToken)!;

      client.actions.addUser('user-1', 'Alice', 25);
      client.actions.addUser('user-2', 'Bob', 30);
      client.actions.addUser('user-3', 'Charlie', 35);
      await flushMicrotask();

      expect(Object.keys(client.state.users)).toHaveLength(3);
      expect(client.state.users['user-2'].name).toBe('Bob');
    });
  });

  describe('Edge Cases', () => {
    it('should handle toggle on non-existent todo gracefully', async () => {
      const client = system.getClient(TodosToken)!;

      client.actions.addTodo('Task 1');
      await flushMicrotask();

      const originalLength = client.state.todos.length;

      // Toggle non-existent ID
      client.actions.toggleTodo('non-existent-id');
      await flushMicrotask();

      // State should be unchanged
      expect(client.state.todos.length).toBe(originalLength);
      expect(client.state.todos[0].done).toBe(false);
    });

    it('should handle remove on non-existent todo gracefully', async () => {
      const client = system.getClient(TodosToken)!;

      client.actions.addTodo('Task 1');
      await flushMicrotask();

      const originalLength = client.state.todos.length;

      // Remove non-existent ID
      client.actions.removeTodo('non-existent-id');
      await flushMicrotask();

      // State should be unchanged
      expect(client.state.todos.length).toBe(originalLength);
    });

    it('should handle adding tag to non-existent user gracefully', async () => {
      const client = system.getClient(NestedToken)!;

      // Try to add tag to non-existent user
      client.actions.addTag('non-existent-user', 'tag');
      await flushMicrotask();

      // State should be unchanged (empty)
      expect(Object.keys(client.state.users).length).toBe(0);
    });

    it('should handle empty string values', async () => {
      const client = system.getClient(TodosToken)!;

      client.actions.addTodo('');
      await flushMicrotask();

      expect(client.state.todos.length).toBe(1);
      expect(client.state.todos[0].text).toBe('');
    });

    it('should handle rapid sequential updates', async () => {
      const client = system.getClient(TodosToken)!;

      // Add many todos rapidly
      for (let i = 0; i < 10; i++) {
        client.actions.addTodo(`Task ${i}`);
      }
      await flushMicrotask();

      expect(client.state.todos.length).toBe(10);
      expect(client.state.todos[5].text).toBe('Task 5');
    });
  });

  describe('Document as State Pattern', () => {
    it('should expose document directly as state (no wrapper)', async () => {
      const client = system.getClient(TodosToken);
      expect(client).not.toBeNull();

      client!.actions.addTodo('Test');
      await flushMicrotask();

      // State IS the document
      expect(client!.state.todos).toBeDefined();
      expect(Array.isArray(client!.state.todos)).toBe(true);

      // NOT wrapped like state.document.todos
      expect((client!.state as any).document).toBeUndefined();
    });

    it('should allow direct property access on state', async () => {
      const client = system.getClient(NestedToken)!;

      client.actions.addUser('user-1', 'Test User', 42);
      await flushMicrotask();

      // Direct access to nested properties
      expect(client.state.users['user-1'].profile.age).toBe(42);
    });
  });

  describe('State Consistency', () => {
    it('should maintain state consistency across updates', async () => {
      const client = system.getClient(TodosToken)!;

      // Add todos
      client.actions.addTodo('Task 1');
      client.actions.addTodo('Task 2');
      await flushMicrotask();

      const id1 = client.state.todos[0].id;

      // Toggle and remove
      client.actions.toggleTodo(id1);
      await flushMicrotask();

      expect(client.state.todos[0].done).toBe(true);
      expect(client.state.todos.length).toBe(2);

      client.actions.removeTodo(id1);
      await flushMicrotask();

      expect(client.state.todos.length).toBe(1);
      expect(client.state.todos[0].text).toBe('Task 2');
    });

    it('should not lose data during rapid updates', async () => {
      const client = system.getClient(NestedToken)!;

      // Add users rapidly
      client.actions.addUser('user-1', 'Alice', 25);
      client.actions.addUser('user-2', 'Bob', 30);
      await flushMicrotask();

      // Modify rapidly
      client.actions.addTag('user-1', 'tag1');
      client.actions.addTag('user-2', 'tag2');
      client.actions.addTag('user-1', 'tag3');
      await flushMicrotask();

      // Verify all changes are present
      expect(client.state.users['user-1'].profile.tags).toContain('tag1');
      expect(client.state.users['user-1'].profile.tags).toContain('tag3');
      expect(client.state.users['user-2'].profile.tags).toContain('tag2');
    });
  });
});
