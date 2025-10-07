/**
 * Internal protocol events used by the Ensemble framework for coordination
 * between ActorClient and Actor instances.
 *
 * These events are prefixed with __ to distinguish them from user-defined events.
 */
export const PROTOCOL_EVENTS = {
  /** Request for actor to send its current state */
  STATE_REQUEST: '__state-request',
  /** Actor sending its state to client */
  STATE: '__state',
  /** Client notifying that state has been hydrated */
  HYDRATED: '__hydrated',
} as const;

export type ProtocolEventName = typeof PROTOCOL_EVENTS[keyof typeof PROTOCOL_EVENTS];
