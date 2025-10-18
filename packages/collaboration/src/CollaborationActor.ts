import * as Automerge from '@automerge/automerge';
import { Actor, effect, type IActorClient, type StateShape } from '@d-buckner/ensemble-core';
import type { PeerMessagingActor } from './PeerMessagingActor';
import type { CollaborationEvents, AutomergeDoc, SyncState, MessagePayload } from './types';
import type { Draft } from 'mutative';

/**
 * Dependencies for CollaborationActor
 */
export interface CollaborationDeps {
  connection: IActorClient<PeerMessagingActor>;
}

/**
 * CollaborationActor - Generic CRDT document manager
 *
 * Core innovation: TDoc IS the state. No wrapper objects, no metadata pollution.
 * All mutations go through setState(), which is internally backed by Automerge
 * for automatic conflict resolution.
 *
 * Users extend this class and add domain-specific actions.
 *
 * @example
 * ```typescript
 * interface TodoDoc {
 *   todos: Array<{ id: string; text: string; done: boolean }>;
 * }
 *
 * class TodosActor extends CollaborationActor<TodoDoc> {
 *   static readonly initialState: TodoDoc = { todos: [] };
 *
 *   constructor() {
 *     super(TodosActor.initialState);
 *   }
 *
 *   @action
 *   addTodo(text: string): void {
 *     this.setState(draft => {
 *       draft.todos.push({ id: `todo-${Date.now()}`, text, done: false });
 *     });
 *   }
 * }
 * ```
 */
export class CollaborationActor<TDoc extends Record<string, any> = Record<string, any>> extends Actor<TDoc, CollaborationEvents> {
  // Automerge internals (private, NOT in state)
  private automergeDoc: AutomergeDoc<TDoc>;
  private syncStates = new Map<string, SyncState>();

  protected declare deps: CollaborationDeps;

  /**
   * Create a new CollaborationActor with an initial document.
   * The document becomes the actor's state directly.
   *
   * @param initialDocument - Initial CRDT document (will be wrapped by Automerge)
   */
  constructor(initialDocument: StateShape<TDoc>) {
    super(initialDocument);
    this.automergeDoc = Automerge.from(initialDocument as TDoc);
  }

  /**
   * Override setState to route through Automerge CRDT.
   *
   * This enables transparent conflict resolution - users call setState()
   * just like any other actor, but changes are automatically synced
   * with peers and conflicts are resolved via Automerge.
   *
   * @param updater - Function that mutates a draft of the current state
   */
  protected setState(updater: (draft: Draft<TDoc>) => void): void {
    // 1. Apply via Automerge (conflict resolution)
    const newDoc = Automerge.change(this.automergeDoc, updater as any);
    const changes = Automerge.getChanges(this.automergeDoc, newDoc);
    this.automergeDoc = newDoc;

    // 2. Update actor state via parent (triggers state events)
    const jsDoc = Automerge.toJS(newDoc);
    super.setState(draft => {
      // Directly assign each property to ensure reactivity
      (Object.keys(jsDoc) as Array<keyof TDoc>).forEach(key => {
        (draft as TDoc)[key] = jsDoc[key];
      });
    });

    // 3. Generate and send sync messages for peers
    if (changes.length > 0) {
      const peers = this.deps.connection.state.connectedPeers;
      for (const peerId of peers) {
        const syncMsg = this.generateSyncMessageForPeer(peerId);
        if (syncMsg) {
          // PeerMessagingActor handles routing to appropriate transport
          this.deps.connection.actions.sendTo(peerId, syncMsg);
        }
      }
    }
  }

  // ========================================
  // Effects: React to connection events
  // ========================================

  /**
   * Handle incoming CRDT sync messages from peers.
   * Applies remote changes and generates response if needed.
   */
  @effect('connection.messageReceived')
  private handleIncomingMessage({ peerId, message }: MessagePayload): void {
    const syncState = this.syncStates.get(peerId) || Automerge.initSyncState();

    const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
      this.automergeDoc,
      syncState,
      message
    );

    this.syncStates.set(peerId, newSyncState);

    // Document changed - update via parent setState (skip sync broadcast)
    if (newDoc !== this.automergeDoc) {
      this.automergeDoc = newDoc;
      const jsDoc = Automerge.toJS(newDoc);
      super.setState(draft => {
        // Directly assign each property to ensure reactivity
        (Object.keys(jsDoc) as Array<keyof TDoc>).forEach(key => {
          (draft as TDoc)[key] = jsDoc[key];
        });
      });
    }

    // Generate response if needed
    const [nextSyncState, responseMsg] = Automerge.generateSyncMessage(
      this.automergeDoc,
      newSyncState
    );

    if (responseMsg) {
      this.syncStates.set(peerId, nextSyncState);
      // PeerMessagingActor handles routing
      this.deps.connection.actions.sendTo(peerId, responseMsg);
    }
  }

  /**
   * Initialize sync state when a new peer connects.
   * Sends initial sync message to bring peer up to date.
   */
  @effect('connection.peerConnected')
  private initSyncWithPeer(peerId: string): void {
    const syncState = Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );

    if (message) {
      this.syncStates.set(peerId, newSyncState);
      // PeerMessagingActor handles routing
      this.deps.connection.actions.sendTo(peerId, message);
    }
  }

  /**
   * Clean up sync state when a peer disconnects.
   */
  @effect('connection.peerDisconnected')
  private cleanupPeer(peerId: string): void {
    this.syncStates.delete(peerId);
  }

  // ========================================
  // Private helpers
  // ========================================

  /**
   * Generate a sync message for a specific peer.
   * Updates the peer's sync state.
   *
   * @param peerId - ID of the peer to generate sync message for
   * @returns Sync message or null if no sync needed
   */
  private generateSyncMessageForPeer(peerId: string): Uint8Array | null {
    const syncState = this.syncStates.get(peerId) || Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );
    if (message) {
      this.syncStates.set(peerId, newSyncState);
    }
    return message;
  }
}
