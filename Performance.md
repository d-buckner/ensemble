# Performance Considerations

## Message Passing Overhead

Ensemble's architecture uses message passing for all actor communication. Understanding the performance characteristics helps you make informed decisions about thread topology.

### Same-Thread Communication

When actors communicate on the same thread, messages are passed directly without serialization. The overhead is minimal - just the routing logic through the local ThreadBus. This is comparable to event emitter patterns and significantly faster than cross-thread communication.

**When to use**: Default for most actors unless you have specific performance requirements that benefit from parallel execution.

### Cross-Thread Communication

When actors communicate across threads (main thread to worker, or worker to worker), messages must be serialized and transferred. Ensemble uses [msgpackr](https://github.com/kriszyp/msgpackr) with transferable buffers for this.

**Key Performance Characteristics**:
- **Serialization**: Data is serialized into ArrayBuffer format using msgpackr, which is highly optimized and significantly faster than JSON
- **Buffer Transfer**: Uses transferable ArrayBuffers which transfer ownership - the buffer memory itself is not copied, but ownership moves between threads
- **Isolation maintained**: Once transferred, the original context loses access to that buffer, so there's no shared mutable state

The key distinction: serialization has a cost, but buffer transfer avoids the additional cost of copying the serialized bytes. It's more efficient than serialize + copy, but not free.

**When to use**: For computationally expensive operations (data processing, heavy calculations) or when you need to keep the main thread responsive.

## Worker Thread Trade-offs

### Benefits of Workers
- **Main thread responsiveness**: Offload expensive computations
- **True parallelism**: Utilize multiple CPU cores
- **Isolation**: Crashes in worker don't affect main thread

### Costs of Workers
- **Message serialization overhead**: Serialization has a cost, even with msgpackr's optimizations
- **Coordination overhead**: All cross-thread messages route through the main thread
- **Increased complexity**: Debugging across threads is harder
- **Memory overhead**: Each worker has its own JavaScript runtime

### The Worker Count Problem

As you add more workers, coordination overhead increases. The main thread's CentralMessageBus must route messages between workers, creating a potential bottleneck.

**Suggestions**:
- Start with services on the main thread
- Move specific services to workers when profiling shows benefit
- Avoid creating many workers "just in case"
- Consider the ratio of computation to communication

## Optimization Strategies

### 1. Batch Messages
If a service emits many events in quick succession, consider batching them into a single message to reduce serialization overhead.

### 2. Minimize State Transfer
Keep transferred state minimal. Instead of sending entire objects, send just what changed.

### 3. Profile Before Optimizing
Use browser profiling tools to identify actual bottlenecks before moving actors to workers. The coordination overhead might outweigh the benefits.

### 4. Colocate Related Actors
Actors that communicate frequently should generally run on the same thread to avoid serialization costs.

## Performance Monitoring

When building with Ensemble, monitor:
- **Message volume**: How many messages are being passed?
- **Message size**: Are you transferring large payloads?
- **Main thread utilization**: Is the CentralMessageBus becoming a bottleneck?
- **Worker idle time**: Are workers underutilized?

## When to Use Workers

Good candidates for worker threads:
- Heavy data processing (parsing, transforming large datasets)
- Computationally expensive algorithms
- Operations that would block the main thread for >16ms
- Actors with infrequent communication but expensive computation

Poor candidates for worker threads:
- Actors that communicate frequently with main thread actors
- Lightweight state management
- UI-related logic that needs immediate response
- Actors with high message volume but low computation
