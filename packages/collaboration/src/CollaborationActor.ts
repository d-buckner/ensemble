import * as Automerge from '@automerge/automerge';
import { Actor, effect, type IActorClient } from '@d-buckner/ensemble-core';
import type { PeerMessagingActor } from './PeerMessagingActor';
import type { CollaborationEvents, AutomergeDoc, SyncState, MessagePayload, RoomJoinedPayload } from './types';
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
 * interface TodoActions {
 *   addTodo(text: string): void;
 * }
 *
 * class TodosActor extends CollaborationActor<TodoDoc, TodoActions> {
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
export class CollaborationActor<
  TDoc extends Record<string, any> = Record<string, any>,
  TActions = {}
> extends Actor<TDoc, TActions, CollaborationEvents> {
  // Automerge internals (private, NOT in state)
  // Null until roomJoined - allows offline-first usage before peers connect
  private automergeDoc: AutomergeDoc<TDoc> | null = null;
  private syncStates = new Map<string, SyncState>();

  protected declare deps: CollaborationDeps;

  /**
   * This enables transparent conflict resolution - users call setState()
   * just like any other actor, but changes are automatically synced
   * with peers and conflicts are resolved via Automerge.
   *
   * Before peers connect (automergeDoc is null), acts as normal Actor with local state only.
   *
   * @param updater - Function that mutates a draft of the current state
   * @returns Promise that resolves when the state update has been committed
   */
  protected setState(updater: (draft: Draft<TDoc>) => void): Promise<void> {
    // If no Automerge doc yet, just update local state (offline-first)
    if (!this.automergeDoc) {
      return super.setState(updater);
    }

    // 1. Apply via Automerge (conflict resolution)
    const newDoc = Automerge.change(this.automergeDoc, updater as any);
    const changes = Automerge.getChanges(this.automergeDoc, newDoc);
    this.automergeDoc = newDoc;

    // 2. Update actor state via parent (triggers state events)
    const jsDoc = Automerge.toJS(newDoc);

    // 3. Generate and send sync messages for peers
    if (changes.length > 0) {
      const peers = this.deps.connection.state.connectedPeers;
      console.log(`[CollaborationActor] 📝 Broadcasting ${changes.length} change(s) to ${peers.length} peer(s)`);
      for (const peerId of peers) {
        const syncMsg = this.generateSyncMessageForPeer(peerId);
        if (syncMsg) {
          // PeerMessagingActor handles routing to appropriate transport
          this.deps.connection.actions.sendTo(peerId, syncMsg);
        }
      }
    }

    return super.setState(draft => {
      // Directly assign each property to ensure reactivity
      (Object.keys(jsDoc) as Array<keyof TDoc>).forEach(key => {
        (draft as TDoc)[key] = jsDoc[key];
      });
    });
  }

  // ========================================
  // Effects: React to connection events
  // ========================================

  /**
   * Handle room joined event to initialize Automerge document.
   * First peer in room creates doc from current state, others start empty.
   */
  @effect('connection.roomJoined')
  private handleRoomJoined(payload: RoomJoinedPayload): void {
    // Joining peer - start empty, receive via sync
    if (payload.peerIds.length > 0) {
      this.automergeDoc = Automerge.init();
      console.log(`[CollaborationActor] 👋 Joining peer - initialized empty Automerge doc (${payload.peerIds.length} existing peer(s))`);
      return;
    }

    // First peer - initialize from current state
    this.automergeDoc = Automerge.from(this.state as TDoc);
    console.log('[CollaborationActor] 🎉 First peer - initialized Automerge doc from current state');
  }

  /**
   * Handle incoming CRDT sync messages from peers.
   * Applies remote changes and generates response if needed.
   */
  @effect('connection.messageReceived')
  private handleIncomingMessage({ peerId, message }: MessagePayload): void {
    console.log(`[CollaborationActor] 📨 Received sync message from ${peerId} (${message.length} bytes)`);

    // Guard: Automerge doc must be initialized before receiving sync messages
    if (!this.automergeDoc) {
      console.warn('[CollaborationActor] ⚠️  Received sync message before Automerge doc initialized - dropping message');
      return;
    }

    const syncState = this.syncStates.get(peerId) || Automerge.initSyncState();

    const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
      this.automergeDoc,
      syncState,
      message
    );

    this.syncStates.set(peerId, newSyncState);

    // Document changed - update via parent setState (skip sync broadcast)
    if (newDoc !== this.automergeDoc) {
      console.log(`[CollaborationActor] ✅ Document updated from ${peerId}`);
      this.automergeDoc = newDoc;
      const jsDoc = Automerge.toJS(newDoc);
      super.setState(draft => {
        // Directly assign each property to ensure reactivity
        (Object.keys(jsDoc) as Array<keyof TDoc>).forEach(key => {
          (draft as TDoc)[key] = jsDoc[key];
        });
      });
    } else {
      console.log(`[CollaborationActor] ℹ️  No document changes from ${peerId}`);
    }

    // Generate response if needed
    const [nextSyncState, responseMsg] = Automerge.generateSyncMessage(
      this.automergeDoc,
      newSyncState
    );

    if (responseMsg) {
      console.log(`[CollaborationActor] 📤 Sending sync response to ${peerId} (${responseMsg.length} bytes)`);
      this.syncStates.set(peerId, nextSyncState);
      // PeerMessagingActor handles routing
      this.deps.connection.actions.sendTo(peerId, responseMsg);
    } else {
      console.log(`[CollaborationActor] ℹ️  No sync response needed for ${peerId}`);
    }
  }

  /**
   * Initialize sync state when a new peer connects.
   * Sends initial sync message to bring peer up to date.
   */
  @effect('connection.peerConnected')
  private initSyncWithPeer(peerId: string): void {
    console.log(`[CollaborationActor] 🔄 Peer connected, initiating sync with: ${peerId}`);

    // Guard: Automerge doc must be initialized before syncing with peers
    if (!this.automergeDoc) {
      console.warn('[CollaborationActor] ⚠️  Peer connected before Automerge doc initialized - skipping sync');
      return;
    }

    const syncState = Automerge.initSyncState();
    const [newSyncState, message] = Automerge.generateSyncMessage(
      this.automergeDoc,
      syncState
    );

    if (!message) {
      console.log(`[CollaborationActor] ⚠️  No sync message generated for ${peerId}`);
      return;
    }

    console.log(`[CollaborationActor] 📤 Sending initial sync message to ${peerId} (${message.length} bytes)`);
    this.syncStates.set(peerId, newSyncState);
    // PeerMessagingActor handles routing
    this.deps.connection.actions.sendTo(peerId, message);
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
    // Guard: Automerge doc must be initialized
    if (!this.automergeDoc) {
      return null;
    }

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
