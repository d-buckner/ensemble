import { ActorSystem, createActorToken, action } from '@d-buckner/ensemble-core';
import { describe, it, expect, beforeEach } from 'vitest';
import { CollaborationActor } from '../CollaborationActor';
import { PeerMessagingActor } from '../PeerMessagingActor';
import { WebRTCActor } from '../WebRTCActor';
import { WebSocketActor } from '../WebSocketActor';

/**
 * Integration tests for the full collaboration stack.
 *
 * These tests verify that multiple CollaborationActors can work together
 * within a complete actor system hierarchy.
 */

// Test document type
interface CounterDoc {
  count: number;
  lastEditor: string | null;
}

interface CounterActions {
  increment(editorId: string): void;
  decrement(editorId: string): void;
  add(value: number, editorId: string): void;
  reset(): void;
}

// Test actor that extends CollaborationActor
class CounterActor extends CollaborationActor<CounterDoc, CounterActions> {
  static readonly initialState: CounterDoc = {
    count: 0,
    lastEditor: null,
  };

  constructor() {
    super(CounterActor.initialState);
  }

  @action
  increment(editorId: string): void {
    this.setState(draft => {
      draft.count += 1;
      draft.lastEditor = editorId;
    });
  }

  @action
  decrement(editorId: string): void {
    this.setState(draft => {
      draft.count -= 1;
      draft.lastEditor = editorId;
    });
  }

  @action
  add(value: number, editorId: string): void {
    this.setState(draft => {
      draft.count += value;
      draft.lastEditor = editorId;
    });
  }

  @action
  reset(): void {
    this.setState(draft => {
      draft.count = 0;
      draft.lastEditor = null;
    });
  }
}

describe('Integration: Full Actor Hierarchy', () => {
  let system: ActorSystem;

  const CounterToken = createActorToken<CounterActor>('counter');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

    // Build complete actor hierarchy
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
      token: CounterToken,
      actor: CounterActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  it('should initialize full actor stack', () => {
    const counter = system.getClient(CounterToken);
    const messaging = system.getClient(PeerMessagingToken);
    const websocket = system.getClient(WebSocketToken);
    const webrtc = system.getClient(WebRTCToken);

    expect(counter).not.toBeNull();
    expect(messaging).not.toBeNull();
    expect(websocket).not.toBeNull();
    expect(webrtc).not.toBeNull();
  });

  it('should have correct dependency hierarchy', () => {
    const counter = system.getClient(CounterToken);
    const messaging = system.getClient(PeerMessagingToken);

    expect(counter).not.toBeNull();
    expect(messaging).not.toBeNull();

    // Counter depends on PeerMessaging
    // PeerMessaging depends on WebSocket and WebRTC
    expect(counter!.state).toBeDefined();
    expect(messaging!.state).toBeDefined();
  });

  it('should maintain state isolation between actors', async () => {
    const counter = system.getClient(CounterToken)!;
    const messaging = system.getClient(PeerMessagingToken)!;

    counter.actions.increment('test');
    await flushMicrotask();

    // Counter state changes
    expect(counter.state.count).toBe(1);

    // Messaging state remains unchanged
    expect(messaging.state.connectedPeers.length).toBe(0);
  });

  it('should handle multiple operations across actor hierarchy', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.increment('editor1');
    counter.actions.increment('editor2');
    counter.actions.add(5, 'editor3');
    await flushMicrotask();

    expect(counter.state.count).toBe(7);
    expect(counter.state.lastEditor).toBe('editor3');
  });

  it('should allow actions on different actors independently', async () => {
    const counter = system.getClient(CounterToken)!;
    const messaging = system.getClient(PeerMessagingToken)!;

    counter.actions.add(10, 'test');
    messaging.actions.sendTo('peer-1', new Uint8Array([1, 2, 3]));

    await flushMicrotask();

    expect(counter.state.count).toBe(10);
    expect(() => messaging.actions.broadcast(new Uint8Array([4, 5, 6]))).not.toThrow();
  });
});

describe('Integration: Collaboration Actor Isolation', () => {
  let system: ActorSystem;
  const CounterToken = createActorToken<CounterActor>('counter');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

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
      token: CounterToken,
      actor: CounterActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  it('should keep Automerge internals private', () => {
    const counter = system.getClient(CounterToken);
    expect(counter).not.toBeNull();

    // State should be the document directly, not wrapped
    expect(counter!.state.count).toBeDefined();
    expect(counter!.state.lastEditor).toBeDefined();

    // No Automerge metadata should be exposed
    expect((counter!.state as any).automergeDoc).toBeUndefined();
    expect((counter!.state as any).syncStates).toBeUndefined();
  });

  it('should handle rapid consecutive updates', async () => {
    const counter = system.getClient(CounterToken);
    expect(counter).not.toBeNull();

    // Rapidly fire multiple updates
    for (let i = 0; i < 10; i++) {
      counter!.actions.increment(`editor-${i}`);
    }

    await flushMicrotask();

    expect(counter!.state.count).toBe(10);
    expect(counter!.state.lastEditor).toBe('editor-9');
  });

  it('should preserve state through multiple operations', async () => {
    const counter = system.getClient(CounterToken);
    expect(counter).not.toBeNull();

    // Sequence of operations
    counter!.actions.add(100, 'editor1');
    await flushMicrotask();

    counter!.actions.decrement('editor2');
    await flushMicrotask();

    counter!.actions.increment('editor3');
    await flushMicrotask();

    // Final state: 100 - 1 + 1 = 100
    expect(counter!.state.count).toBe(100);
    expect(counter!.state.lastEditor).toBe('editor3');
  });

  it('should handle state resets', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.add(50, 'editor1');
    await flushMicrotask();

    expect(counter.state.count).toBe(50);

    counter.actions.reset();
    await flushMicrotask();

    expect(counter.state.count).toBe(0);
    expect(counter.state.lastEditor).toBeNull();
  });
});

describe('Integration: Multi-Actor Coordination', () => {
  let system: ActorSystem;
  const Counter1Token = createActorToken<CounterActor>('counter1');
  const Counter2Token = createActorToken<CounterActor>('counter2');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

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

    // Register two separate CollaborationActors
    system.register({
      token: Counter1Token,
      actor: CounterActor,
      dependencies: { connection: PeerMessagingToken },
    });

    system.register({
      token: Counter2Token,
      actor: CounterActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  it('should maintain independent state for multiple collaboration actors', async () => {
    const counter1 = system.getClient(Counter1Token)!;
    const counter2 = system.getClient(Counter2Token)!;

    counter1.actions.add(10, 'editor1');
    counter2.actions.add(20, 'editor2');
    await flushMicrotask();

    expect(counter1.state.count).toBe(10);
    expect(counter2.state.count).toBe(20);
  });

  it('should handle concurrent operations on different actors', async () => {
    const counter1 = system.getClient(Counter1Token)!;
    const counter2 = system.getClient(Counter2Token)!;

    // Perform operations on both concurrently
    counter1.actions.increment('editor1');
    counter2.actions.decrement('editor2');
    counter1.actions.add(5, 'editor1');
    counter2.actions.add(10, 'editor2');

    await flushMicrotask();

    // Counter1: 0 + 1 + 5 = 6
    expect(counter1.state.count).toBe(6);
    // Counter2: 0 - 1 + 10 = 9
    expect(counter2.state.count).toBe(9);
  });

  it('should allow reset on one actor without affecting others', async () => {
    const counter1 = system.getClient(Counter1Token)!;
    const counter2 = system.getClient(Counter2Token)!;

    counter1.actions.add(100, 'editor1');
    counter2.actions.add(200, 'editor2');
    await flushMicrotask();

    counter1.actions.reset();
    await flushMicrotask();

    expect(counter1.state.count).toBe(0);
    expect(counter2.state.count).toBe(200);
  });

  it('should maintain state consistency with rapid operations on multiple actors', async () => {
    const counter1 = system.getClient(Counter1Token)!;
    const counter2 = system.getClient(Counter2Token)!;

    // Rapidly alternate operations
    for (let i = 0; i < 5; i++) {
      counter1.actions.increment('editor1');
      counter2.actions.increment('editor2');
    }

    await flushMicrotask();

    expect(counter1.state.count).toBe(5);
    expect(counter2.state.count).toBe(5);
  });
});

describe('Integration: Error Handling and Edge Cases', () => {
  let system: ActorSystem;
  const CounterToken = createActorToken<CounterActor>('counter');
  const PeerMessagingToken = createActorToken<PeerMessagingActor>('peerMessaging');
  const WebSocketToken = createActorToken<WebSocketActor>('websocket');
  const WebRTCToken = createActorToken<WebRTCActor>('webrtc');

  beforeEach(async () => {
    system = new ActorSystem();

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
      token: CounterToken,
      actor: CounterActor,
      dependencies: { connection: PeerMessagingToken },
    });

    await system.start();
  });

  it('should handle large value additions', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.add(1000000, 'editor');
    await flushMicrotask();

    expect(counter.state.count).toBe(1000000);
  });

  it('should handle negative values', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.add(-50, 'editor');
    await flushMicrotask();

    expect(counter.state.count).toBe(-50);
  });

  it('should handle zero value operations', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.add(0, 'editor');
    await flushMicrotask();

    expect(counter.state.count).toBe(0);
    expect(counter.state.lastEditor).toBe('editor');
  });

  it('should handle empty string editor IDs', async () => {
    const counter = system.getClient(CounterToken)!;

    counter.actions.increment('');
    await flushMicrotask();

    expect(counter.state.count).toBe(1);
    expect(counter.state.lastEditor).toBe('');
  });

  it('should maintain state through alternating increment/decrement', async () => {
    const counter = system.getClient(CounterToken)!;

    for (let i = 0; i < 10; i++) {
      counter.actions.increment('up');
      counter.actions.decrement('down');
    }

    await flushMicrotask();

    // Should cancel out to 0
    expect(counter.state.count).toBe(0);
    expect(counter.state.lastEditor).toBe('down');
  });

  it('should handle rapid state changes without data loss', async () => {
    const counter = system.getClient(CounterToken)!;

    const operations = [
      () => counter.actions.add(10, 'op1'),
      () => counter.actions.increment('op2'),
      () => counter.actions.decrement('op3'),
      () => counter.actions.add(5, 'op4'),
      () => counter.actions.reset(),
      () => counter.actions.add(100, 'op5'),
    ];

    operations.forEach(op => op());
    await flushMicrotask();

    // After reset, only the last add should count
    expect(counter.state.count).toBe(100);
    expect(counter.state.lastEditor).toBe('op5');
  });

});
