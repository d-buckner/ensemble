// Base event map type
export type EventMap = Record<string, unknown>;

// Reserved base events for all actors
export interface BaseEvents {
  error: {
    source: 'action' | 'effect';
    method: string;
    error: Error;
    details?: unknown;
    timestamp: number;
  };
  __action: {
    method: string;
    args: any[];
  };
}

// Combine state properties + custom events + base events
export type AllEvents<TState, TEvents extends EventMap> =
  BaseEvents &
  { [K in keyof TState]: TState[K] } &
  TEvents;

// Type-safe listener with specific payload
export type TypedListener<T> = (payload: T) => void;