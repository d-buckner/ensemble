import { describe, it, expect, beforeEach } from 'vitest';
import ActorSystem from './core/ActorSystem';
import { Actor } from './core/Actor';
import { action, effect } from './core/decorators';
import { MAIN_THREAD_ID } from './constants';
import type { ActorClient } from './core/ActorClient';

/**
 * E2E Integration Test
 * Tests the full actor system with decorators, actions, effects, and dependencies
 */

// ============================================================================
// TodoActor - Actor with actions and state
// ============================================================================

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

interface TodoState extends Record<string, unknown> {
  todos: Todo[];
  filter: string;
}

interface TodoEvents extends Record<string, unknown> {
  todoAdded: { id: string; text: string };
  todoToggled: { id: string };
}

class TodoActor extends Actor<TodoState, TodoEvents> {
  constructor() {
    super({
      todos: [],
      filter: ''
    });
  }

  @action
  addTodo(text: string): void {
    const id = `todo-${Date.now()}`;
    this.setState(draft => {
      draft.todos.push({ id, text, done: false });
    });
    this.emit('todoAdded', { id, text });
  }

  @action
  toggleTodo(id: string): void {
    this.setState(draft => {
      const todo = draft.todos.find(t => t.id === id);
      if (todo) {
        todo.done = !todo.done;
      }
    });
    this.emit('todoToggled', { id });
  }

  @action
  setFilter(filter: string): void {
    this.setState(draft => {
      draft.filter = filter;
    });
  }
}

// ============================================================================
// StatsActor - Actor with effects and dependencies
// ============================================================================

interface StatsState extends Record<string, unknown> {
  totalCount: number;
  completedCount: number;
  activeCount: number;
}

interface StatsDeps {
  todoActor: ActorClient<TodoActor>;
}

class StatsActor extends Actor<StatsState> {
  protected deps!: StatsDeps;

  constructor() {
    super({
      totalCount: 0,
      completedCount: 0,
      activeCount: 0,
    });
  }

  @effect('todoActor.todos')
  updateStats(): void {
    const todos = this.deps.todoActor.state.todos;

    this.setState(draft => {
      draft.totalCount = todos.length;
      draft.completedCount = todos.filter((t: Todo) => t.done).length;
      draft.activeCount = todos.filter((t: Todo) => !t.done).length;
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E Integration Test', () => {
  let system: ActorSystem;
  let todoClient: ActorClient<TodoActor>;
  let statsClient: ActorClient<StatsActor>;

  beforeEach(async () => {
    system = new ActorSystem();

    // Register TodoActor
    system.register({
      id: 'todo-actor',
      actor: TodoActor,
      threadId: MAIN_THREAD_ID,
      options: {},
    });

    // Register StatsActor with dependency on TodoActor
    system.register({
      id: 'stats-actor',
      actor: StatsActor,
      threadId: MAIN_THREAD_ID,
      options: {},
      dependencies: {
        todoActor: 'todo-actor',
      },
    });

    // Start the system
    await system.start();

    // Get clients
    todoClient = system.getClient<TodoActor>('todo-actor')!;
    statsClient = system.getClient<StatsActor>('stats-actor')!;
  });

  it('should initialize actors with correct initial state', () => {
    expect(todoClient.state.todos).toEqual([]);
    expect(todoClient.state.filter).toBe('');
    expect(statsClient.state.totalCount).toBe(0);
  });

  it('should call actions and update state', async () => {
    // Call action via client
    todoClient.actions.addTodo?.('Buy milk');

    // Give time for async message passing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify state updated
    expect(todoClient.state.todos).toHaveLength(1);
    expect(todoClient.state.todos[0].text).toBe('Buy milk');
    expect(todoClient.state.todos[0].done).toBe(false);
  });

  it('should emit custom events when actions are called', async () => {
    const events: any[] = [];

    // Subscribe to custom event
    todoClient.on('todoAdded', (payload) => {
      events.push(payload);
    });

    // Call action
    todoClient.actions.addTodo?.('Write tests');

    // Give time for async message passing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify event was emitted
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('Write tests');
  });

  it('should emit state property events when state changes', async () => {
    const todoUpdates: any[] = [];

    // Subscribe to state property event
    todoClient.on('todos', (todos) => {
      todoUpdates.push([...todos]);
    });

    // Call action that modifies todos
    todoClient.actions.addTodo?.('Task 1');
    await new Promise(resolve => setTimeout(resolve, 10));

    todoClient.actions.addTodo?.('Task 2');
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify state events were emitted
    expect(todoUpdates.length).toBeGreaterThanOrEqual(2);
    expect(todoUpdates[0]).toHaveLength(1);
    expect(todoUpdates[1]).toHaveLength(2);
  });

  it('should trigger effects when dependency state changes', async () => {
    // Initial stats should be zero
    expect(statsClient.state.totalCount).toBe(0);

    // Add todo
    todoClient.actions.addTodo?.('Task 1');
    await new Promise(resolve => setTimeout(resolve, 10));

    // Effect should have updated stats
    expect(statsClient.state.totalCount).toBe(1);
    expect(statsClient.state.activeCount).toBe(1);
    expect(statsClient.state.completedCount).toBe(0);

    // Toggle todo
    const todoId = todoClient.state.todos[0].id;
    todoClient.actions.toggleTodo?.(todoId);
    await new Promise(resolve => setTimeout(resolve, 10));

    // Effect should have updated stats again
    expect(statsClient.state.totalCount).toBe(1);
    expect(statsClient.state.activeCount).toBe(0);
    expect(statsClient.state.completedCount).toBe(1);
  });

  it('should support multiple actions in sequence', async () => {
    todoClient.actions.addTodo?.('Task 1');
    await new Promise(resolve => setTimeout(resolve, 10));

    todoClient.actions.addTodo?.('Task 2');
    await new Promise(resolve => setTimeout(resolve, 10));

    todoClient.actions.setFilter?.('active');
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(todoClient.state.todos).toHaveLength(2);
    expect(todoClient.state.filter).toBe('active');

    // Stats should reflect both todos
    expect(statsClient.state.totalCount).toBe(2);
    expect(statsClient.state.activeCount).toBe(2);
  });

  it('should provide type-safe action calls', () => {
    // Type test - these should compile
    todoClient.actions.addTodo?.('text');
    todoClient.actions.toggleTodo?.('id');
    todoClient.actions.setFilter?.('filter');

    // Actions should exist
    expect(typeof todoClient.actions.addTodo).toBe('function');
    expect(typeof todoClient.actions.toggleTodo).toBe('function');
    expect(typeof todoClient.actions.setFilter).toBe('function');
  });

  it('should provide type-safe event subscriptions', () => {
    // Type test - these should compile
    todoClient.on('todos', (todos) => {
      expect(Array.isArray(todos)).toBe(true);
    });

    todoClient.on('filter', (filter) => {
      expect(typeof filter).toBe('string');
    });

    todoClient.on('todoAdded', (payload) => {
      expect(payload).toHaveProperty('id');
      expect(payload).toHaveProperty('text');
    });

    statsClient.on('totalCount', (count) => {
      expect(typeof count).toBe('number');
    });
  });
});
