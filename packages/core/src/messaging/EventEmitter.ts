type EventCallback<TEventMap> = {
  [K in keyof TEventMap]: (payload: TEventMap[K]) => void;
}[keyof TEventMap];

export default class EventEmitter<TEventMap> {
  private listeners = new Map<string, Set<EventCallback<TEventMap>>>();

  on<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    const key = eventName as string;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key)!.add(callback as EventCallback<TEventMap>);
  }

  off<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    const key = eventName as string;
    const scopedListeners = this.listeners.get(key);
    if (!scopedListeners) {
      return;
    }

    scopedListeners.delete(callback as EventCallback<TEventMap>);

    if (scopedListeners.size === 0) {
      this.listeners.delete(key);
    }
  }

  emit<K extends keyof TEventMap>(eventName: K, payload: TEventMap[K]): void {
    const key = eventName as string;
    this.listeners.get(key)?.forEach(callback => callback(payload as any));
  }

  dispose(): void {
    this.listeners = new Map();
  }

  forEachListener(callback: (eventName: string, listener: EventCallback<TEventMap>) => void): void {
    for (const [eventName, listeners] of this.listeners.entries()) {
      for (const listener of listeners) {
        callback(eventName, listener);
      }
    }
  }
}
