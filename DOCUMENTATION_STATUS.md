# Documentation Status & Recommendations

## Current Documentation

### ✅ Up to Date

**README.md**
- Accurately describes current architecture
- Actor model concepts are correct
- ActorClient description is accurate (though will need update when sync proposal implemented)
- No immediate changes needed

### ⚠️ Needs Updates

**PERFORMANCE.md**
- **Issue**: Describes "same-thread communication" as using direct message passing with minimal overhead
- **Reality After Sync Proposal**: Same-thread main-thread actors will use **direct method calls** (zero message passing overhead)
- **Recommendation**: Update to reflect:
  - Main-thread same-thread: Direct calls (no messaging)
  - Worker same-thread: Message passing within worker
  - Cross-thread: Serialization + message passing

**Section to update:**
```markdown
### Same-Thread Communication (Current)

When actors communicate on the same thread, messages are passed directly
without serialization. The overhead is minimal...

### Same-Thread Communication (Proposed)

**Main-thread actors:** Direct synchronous method calls (zero overhead)
**Worker-thread actors:** Messages passed directly without serialization
**Cross-thread:** Serialization + message transfer
```

## Missing Documentation

### 🚧 Needs Creation

1. **State Management Guide**
   - How state flows through the actor system
   - State batching behavior (current microtask batching)
   - When to use state vs events
   - Best practices for state shape

2. **Effects Guide**
   - What effects are and when to use them
   - Effect execution order (dependency-based)
   - Effects vs state listeners
   - Common patterns

3. **Threading Guide**
   - When to use workers
   - Performance considerations
   - Worker → main communication patterns
   - Main → worker communication patterns
   - Current limitations (no worker → main actions)

4. **Testing Guide**
   - How to test actors
   - Mocking dependencies
   - Testing effects
   - Testing cross-thread communication

## Proposals Directory

Moved to `/proposals`:
- ✅ `PROPOSAL_SYNC_MAIN_THREAD.md` - Synchronous main-thread actors
- ✅ `PROPOSAL_THREAD_SCHEDULER.md` - Thread scheduler proposal

## Recommendations

### Immediate Actions

1. **Update PERFORMANCE.md** to reflect current message-passing behavior (before sync implementation)
2. **Assess WORKER_BUNDLES.md**: Is it current? If not, move to proposals or delete
3. **README.md**: Add note about proposals directory for future architecture

### Post-Sync Implementation

When synchronous main-thread proposal is implemented:

1. **Update README.md**:
   - Clarify that main-thread actors are synchronous
   - Explain ActorClient (sync) vs WorkerActorClient (async)
   - Update "How It Works" section

2. **Update PERFORMANCE.md**:
   - Add section on sync vs async performance
   - Update threading trade-offs
   - Add benchmarks comparing main-thread vs worker

3. **Create new guides**:
   - `docs/STATE_MANAGEMENT.md`
   - `docs/EFFECTS.md`
   - `docs/THREADING.md`
   - `docs/TESTING.md`

### Documentation Structure Proposal

```
ensemble/
├── README.md (overview, getting started)
├── proposals/ (design proposals)
│   ├── PROPOSAL_SYNC_MAIN_THREAD.md
│   └── PROPOSAL_THREAD_SCHEDULER.md
├── docs/ (detailed guides - to be created)
│   ├── STATE_MANAGEMENT.md
│   ├── EFFECTS.md
│   ├── THREADING.md
│   └── TESTING.md
├── PERFORMANCE.md (keep at root - frequently referenced)
└── ARCHITECTURE.md (optional: deep dive into implementation)
```

## Action Items

- [ ] Update PERFORMANCE.md with current state (pre-sync implementation)
- [ ] Create `docs/` directory structure
- [ ] After sync implementation: update all docs to reflect new architecture
- [ ] Add cross-references between docs (README → detailed guides)
