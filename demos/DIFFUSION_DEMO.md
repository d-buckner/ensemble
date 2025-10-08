# Multi-Layer Reaction-Diffusion Demo  
**Actor-thread showcase for [Framework Name]** *(no MIDI)*  

---

## 1. Elevator Pitch  
Live 4-K canvas running 3–8 chemical species in parallel. Each species is an isolated **domain actor** pinned to its own thread; they exchange only boundary rows every frame. Toggle an actor → that chemical layer halts instantly, proving parallel execution. No GPU compute required; still hits 60 fps on 4-core laptops and scales linearly to 64-core Threadrippers.

---

## 2. Visual Outcome  
- Mesmerizing coral-like growth, spirals, spots, and traveling waves.  
- Color-mix overlay reveals interaction zones (activator/inhibitor classic).  
- On-screen metrics: fps, frame-time per actor, thread utilization bar.

---

## 3. Actor Breakdown  
| ID | Name | Thread | Responsibility | In-Port Messages | Out-Port Messages |
|----|------|--------|----------------|------------------|-------------------|
| A | Activator | worker-1 | Gray-Scott solver for species u (promotes growth) | `boundary_v`, `kill_switch` | `boundary_u` |
| B | Inhibitor | worker-2 | Gray-Scott solver for species v (suppresses u) | `boundary_u`, `kill_switch` | `boundary_v` |
| C | Catalyst | worker-3 | Faster diffusing species that speeds up A | `boundary_u`, `params`, `kill_switch` | `boundary_c` |
| D | Poison | worker-4 | Slowly removes activator; optional for dramatic decay | `boundary_u`, `kill_switch` | `boundary_p` |
| E | Renderer | main | Composes textures, handles pan/zoom/sliders | `tex_A`, `tex_B`, … | `kill_switch`, `params` |
| F | Controller | main | UI & knob input, spawns/kills actors | user events | `kill_switch`, `spawn_actor` |

*Note: Add more actors (E+, F+, …) up to core count; each new actor is another species or a duplicate layer with different feed/kill rates.*

---

## 4. Message Flow (per frame)  
1. Local step: every actor runs `n` RK2 steps internally.  
2. Boundary exchange: each actor posts its top/bottom (or left/right) row to its two neighbors (ring topology).  
3. Synchronization: lightweight barrier (actor mailbox flush).  
4. Renderer uploads each species texture to GPU and blends with chosen mode (add, multiply, difference).

---

## 5. Tunables Exposed in UI  
- **Actor count slider** (spawns/kills actors live).  
- **Feed/kill rates per species** (real-time).  
- **Diffusion speed multiplier**.  
- **Color palette & blend mode**.  
- **Boundary wrap vs. zero-flux toggle**.

---

## 6. Scaling Hook  
If `#actors > #cores`, framework transparently multiplexes onto workers; fps drop is visible, reinforcing why 1:1 actor-thread mapping is optimal.

---

## 7. Demo Script (2 min)  
1. Start with 2 actors → dull stripes.  
2. Slide to 4 actors → spirals emerge, fps steady.  
3. Toggle off Actor B (inhibitor) → activator blooms everywhere, proves dependency.  
4. Crank actor count to 8 on 8-core box → fps stays flat, thread monitor shows 100 % across cores.  
5. Zoom in; pan around—no stutter, all layers update simultaneously.

---