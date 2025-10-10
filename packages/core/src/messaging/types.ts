// Combine state properties + custom events + base events
type _AllEvents<TState, TEvents> = { [K in keyof TState]: TState[K] } & TEvents;

// Exclude symbols since they cannot be serialized
export type AllEvents<TState, TEvents> = {
  [K in Exclude<keyof _AllEvents<TState, TEvents>, symbol>]: _AllEvents<TState, TEvents>[K]
};

// Type-safe listener with specific payload
export type TypedListener<T> = (payload: T) => void;
