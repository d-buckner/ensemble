# Ensemble Design Documents

This directory contains design documents and architectural documentation for Ensemble features.

## Structure

- **Active Designs**: Design documents for features under consideration
- **`implemented/`**: Designs that have been implemented and shipped

## Active Designs

### Collaboration CRDT Package

**File**: `COLLABORATION_PACKAGE.md`

Design for `@d-buckner/ensemble-collaboration` - a package providing collaboration capabilities through Conflict-Free Replicated Data Types (CRDTs) using Automerge.

**Key Features:**
- Four-actor architecture (CollaborationActor, PeerMessagingActor, WebSocketActor, WebRTCActor)
- Document-as-state pattern (no wrapper objects)
- WebRTC-first with WebSocket fallback
- Effect-driven sync protocol
- Full decoupling of transport layers

**Status**: Design complete, ready for implementation

## Implemented Designs

See the `implemented/` directory for designs that have been implemented:

- **Worker Build System** - Vite plugin for automatic Web Worker bundling from ensemble.json
- **Thread Scheduling System** - Per-thread state batching with ThreadContext
- **Effect System** - Reactive communication between actors

## Contributing Design Documents

When designing a new feature:

1. Create a new file: `FEATURE_NAME.md`
2. Use the collaborative design as a template
3. Include:
   - **Overview** - High-level description
   - **Motivation** - Use cases and why it's needed
   - **Architecture** - Component design and interactions
   - **API Design** - Public interfaces and usage patterns
   - **Implementation Details** - Technical specifics
   - **Testing Strategy** - How to verify correctness
   - **Migration Path** - How to roll out the feature

4. Once implemented, move to `implemented/` with a summary of changes

## Design Principles

All Ensemble designs should follow these core principles:

1. **Actor Model Purity**: Clear state ownership and message passing
2. **Type Safety**: Full TypeScript support with inference
3. **Separation of Concerns**: Single responsibility per actor
4. **Effect-Driven**: One-way event communication
5. **Dependency Injection**: Explicit, type-safe dependencies
6. **Clean APIs**: Users work with domain models, not framework internals
