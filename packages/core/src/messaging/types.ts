// Combine state properties + custom events + base events
export type AllEvents<TState, TEvents> = { [K in keyof TState]: TState[K] } & TEvents;

// Type-safe listener with specific payload
export type TypedListener<T> = (payload: T) => void;