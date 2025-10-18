import { CollaborationActor, type CollaborationDeps } from '@d-buckner/ensemble-collaboration';
import { action } from '@d-buckner/ensemble-core';

// Define document type
export interface TodoDoc {
  todos: Array<{ id: string; text: string; done: boolean }>;
}

// Extend CollaborationActor with domain actions
export class TodosActor extends CollaborationActor<TodoDoc> {
  protected declare deps: CollaborationDeps;
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
        id: `${Date.now()}-${Math.random()}`,
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
}
