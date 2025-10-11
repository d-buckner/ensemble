import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Actor } from './core/Actor';
import ActorSystem from './core/ActorSystem';
import { createActorToken } from './core/ActorToken';
import { action, effect } from './core/decorators';
import type { IActorClient } from './core/types';


// Mock the virtual manifest module
vi.mock('virtual:worker-manifest', () => ({
  WORKER_PATHS: {}
}));

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

interface TodoState {
  todos: Todo[];
  filter: string;
}

interface TodoEvents {
  addTodo: [text: string];
  toggleTodo: [id: string];
  setFilter: [filter: string];
}

class TodoActor extends Actor<TodoState, TodoEvents> {
  static readonly initialState: TodoState = {
    todos: [],
    filter: ''
  };

  constructor() {
    super(TodoActor.initialState);
  }

  @action
  addTodo(text: string): void {
    const id = `todo-${Date.now()}`;
    this.setState(draft => {
      draft.todos.push({ id, text, done: false });
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
  todoActor: IActorClient<TodoActor>;
}

class StatsActor extends Actor<StatsState> {
  static readonly initialState: StatsState = {
    totalCount: 0,
    completedCount: 0,
    activeCount: 0
  };

  protected declare deps: StatsDeps;

  constructor() {
    super(StatsActor.initialState);
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

// Create tokens for actors
const TodoToken = createActorToken<TodoActor>('todo');
const StatsToken = createActorToken<StatsActor>('stats');

describe('E2E Integration Test', () => {
  let system: ActorSystem;
  let todoClient: IActorClient<TodoActor>;
  let statsClient: IActorClient<StatsActor>;

  beforeEach(async () => {
    system = new ActorSystem();

    // Register TodoActor
    system.register({
      token: TodoToken,
      actor: TodoActor,
    });

    // Register StatsActor with dependency on TodoActor
    system.register({
      token: StatsToken,
      actor: StatsActor,
      dependencies: {
        todoActor: TodoToken,
      },
    });

    // Start the system
    await system.start();

    // Get clients
    todoClient = system.getClient(TodoToken)!;
    statsClient = system.getClient(StatsToken)!;
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

  it('should emit state changes when actions are called', async () => {
    const todoUpdates: any[] = [];

    // Subscribe to state property event
    todoClient.on('todos', (todos) => {
      todoUpdates.push(todos);
    });

    // Call action
    todoClient.actions.addTodo?.('Write tests');

    // Give time for async message passing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify state change was emitted
    expect(todoUpdates.length).toBeGreaterThan(0);
    const latestTodos = todoUpdates[todoUpdates.length - 1];
    expect(latestTodos.some((t: any) => t.text === 'Write tests')).toBe(true);
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

    statsClient.on('totalCount', (count) => {
      expect(typeof count).toBe('number');
    });
  });

  it('should properly unsubscribe custom event listeners', async () => {
    // Create a custom event test
    interface CustomEventState extends Record<string, unknown> {
      value: number;
    }

    interface CustomEventEvents {
      customEmitted: { data: string };
    }

    class CustomEmitterActor extends Actor<CustomEventState, CustomEventEvents> {
      static readonly initialState: CustomEventState = { value: 0 };

      constructor() {
        super(CustomEmitterActor.initialState);
      }

      @action
      emitCustom(data: string): void {
        this.emit('customEmitted', { data });
      }
    }

    const CustomToken = createActorToken<CustomEmitterActor>('custom');

    const customSystem = new ActorSystem();
    customSystem.register({
      token: CustomToken,
      actor: CustomEmitterActor,
    });
    await customSystem.start();

    const customClient = customSystem.getClient(CustomToken)!;

    // Subscribe to custom event
    const callback = vi.fn();
    customClient.on('customEmitted', callback);

    // Emit should trigger callback
    customClient.actions.emitCustom?.('test1');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(callback).toHaveBeenCalledTimes(1);

    // Unsubscribe
    customClient.off('customEmitted', callback);

    // Emit again - should NOT trigger callback
    customClient.actions.emitCustom?.('test2');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2

    await customSystem.shutdown();
  });

  it('should use SyncActorClient for main-thread actors (no bus created)', async () => {
    // This test verifies the architecture: main-thread actors should use SyncActorClient
    // and should NOT have a bus created

    // Access the actor instance directly (for testing purposes only)
    const actorInstance = (system as any).instances.get(TodoToken.symbol);

    // Main-thread actors should have NO bus
    expect(actorInstance.bus).toBeUndefined();

    // But should have an internal EventEmitter
    expect((actorInstance as any).internalEventEmitter).toBeDefined();

    // Verify SyncActorClient behavior: state access is direct, not cached
    const state1 = todoClient.state;
    const state2 = todoClient.state;

    // Should return the same reference (direct access, not cached copy)
    expect(state1).toBe(state2);
  });
});
