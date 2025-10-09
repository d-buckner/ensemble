import { createActorSystem } from '@d-buckner/ensemble-solidjs';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { onMount, onCleanup } from 'solid-js';
import type { MessageWithTargets, EventType } from '@d-buckner/ensemble-core';


interface ParticleData {
  id: number;
  graphics: Graphics;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  controlX: number;  // Bezier curve control point
  controlY: number;
  progress: number;
  lifespan: number;
  eventType: EventType;
}

interface NodePosition {
  x: number;
  y: number;
}

interface ActorNode {
  id: string;
  name: string;
  thread: string;
  threadType: 'main' | 'worker';
  position: NodePosition;
}

interface Edge {
  source: string;
  target: string;
}

// Layout positions will be computed from the actual graph
const POSITION_LAYOUTS: Record<string, NodePosition> = {
  MetricGeneratorActor: { x: 400, y: 80 },
  StatisticsActor: { x: 400, y: 220 },
  AnomalyDetectionActor: { x: 250, y: 360 },
  DashboardActor: { x: 550, y: 360 },
};

// Event type colors
const EVENT_TYPE_COLORS: Record<EventType, number> = {
  custom: 0x667eea,     // Purple - custom events (metricBatch, etc.)
  state: 0x4caf50,      // Green - state property events
  system: 0xff9800,     // Orange - system/protocol events (__hydrated, etc.)
};

const NODE_WIDTH = 170;
const NODE_HEIGHT = 80;
const NODE_RADIUS = 8; // Border radius for rounded corners
const THREAD_COLORS = {
  main: 0x667eea,
  worker: 0x4caf50,
};

export function MessageFlowViz() {
  let canvasRef: HTMLCanvasElement | undefined;
  let app: Application | null = null;
  let graphContainer: Container | null = null;
  let particleContainer: Container | null = null;
  let particles: ParticleData[] = [];
  let nextParticleId = 0;

  // Build graph from ActorSystem
  let actorNodes: ActorNode[] = [];
  let edges: Edge[] = [];

  const buildGraphFromSystem = (system: any): void => {
    const actorIds = system.getAllActorIds();
    const nodes: ActorNode[] = [];
    const graphEdges: Edge[] = [];

    console.log('[MessageFlowViz] Building graph from system, actors:', actorIds);

    actorIds.forEach((actorId: string) => {
      const node = system.get(actorId);
      if (!node) return;

      const position = POSITION_LAYOUTS[actorId] || { x: 400, y: 250 };
      const threadType = node.threadId === 'main' ? 'main' : 'worker';

      nodes.push({
        id: actorId,
        name: actorId, // Use token ID instead of minified className
        thread: node.threadId,
        threadType,
        position,
      });

      // Build edges from dependents
      if (node.dependents && node.dependents.length > 0) {
        node.dependents.forEach((depToken: any) => {
          graphEdges.push({
            source: actorId,
            target: depToken.id,
          });
        });
      }
    });

    actorNodes = nodes;
    edges = graphEdges;

    console.log('[MessageFlowViz] Built graph with nodes:', actorNodes);
    console.log('[MessageFlowViz] Built graph with edges:', edges);
  };

  const getNodePosition = (actorId: string): NodePosition | null => {
    const node = actorNodes.find(n => n.id === actorId);
    return node ? node.position : null;
  };

  const drawGraph = (): void => {
    if (!graphContainer) return;

    const container = graphContainer;

    console.log('[MessageFlowViz] Drawing graph with', actorNodes.length, 'nodes and', edges.length, 'edges');

    // Draw edges
    edges.forEach(edge => {
      const sourceNode = actorNodes.find(n => n.id === edge.source);
      const targetNode = actorNodes.find(n => n.id === edge.target);

      if (!sourceNode || !targetNode) return;

      const line = new Graphics();
      line.moveTo(sourceNode.position.x, sourceNode.position.y);
      line.lineTo(targetNode.position.x, targetNode.position.y);
      line.stroke({ width: 2, color: 0x333333, alpha: 0.6 });

      container.addChild(line);
    });

    // Draw nodes
    actorNodes.forEach(node => {
      const nodeGroup = new Container();
      nodeGroup.x = node.position.x;
      nodeGroup.y = node.position.y;

      // Node box
      const box = new Graphics();
      box.roundRect(-NODE_WIDTH / 2, -NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
      box.fill({ color: 0x1a1a1a });
      box.stroke({ width: 2, color: THREAD_COLORS[node.threadType] });
      nodeGroup.addChild(box);

      // Node label
      const nameText = new Text({
        text: node.name,
        style: {
          fontSize: 14,
          fontWeight: 'bold',
          fill: 0xe0e0e0,
          align: 'center',
        },
      });
      nameText.anchor.set(0.5, 0.5);
      nameText.y = -8;
      nodeGroup.addChild(nameText);

      // Thread badge
      const threadText = new Text({
        text: node.thread.toUpperCase(),
        style: {
          fontSize: 9,
          fontWeight: 'bold',
          fill: 0xffffff,
          align: 'center',
        },
      });
      threadText.anchor.set(0.5, 0.5);
      threadText.y = 12;

      const badgeWidth = threadText.width + 12;
      const badge = new Graphics();
      badge.roundRect(-badgeWidth / 2, 5, badgeWidth, 16, 4);
      badge.fill({ color: THREAD_COLORS[node.threadType] });
      nodeGroup.addChild(badge);
      nodeGroup.addChild(threadText);

      container.addChild(nodeGroup);
    });
  };

  const createParticle = (event: MessageWithTargets): void => {
    if (!particleContainer) return;

    const { actorId, eventName, targets, eventType } = event;
    const sourcePos = getNodePosition(actorId);

    if (!sourcePos) {
      console.log('[MessageFlowViz] No position found for actor:', actorId);
      return;
    }

    const color = EVENT_TYPE_COLORS[eventType];

    if (targets.length === 0) {
      console.log('[MessageFlowViz] No targets found for actor:', actorId, 'event:', eventName);
      // For actors with no downstream dependencies, create a visual pulse at the node
      const graphics = new Graphics();

      graphics.circle(0, 0, 4);
      graphics.fill({ color, alpha: 0.9 });

      graphics.x = sourcePos.x;
      graphics.y = sourcePos.y;

      particleContainer!.addChild(graphics);

      // Create a small expanding circle effect
      particles.push({
        id: nextParticleId++,
        graphics,
        sourceX: sourcePos.x,
        sourceY: sourcePos.y,
        targetX: sourcePos.x,
        targetY: sourcePos.y,
        controlX: sourcePos.x,
        controlY: sourcePos.y,
        progress: 0,
        lifespan: 400, // Short pulse
        eventType,
      });
      return;
    }

    console.log('[MessageFlowViz] Creating particle from', actorId, 'to', targets, 'for event:', eventName);

    // Create a particle for each target
    targets.forEach(targetId => {
      const targetPos = getNodePosition(targetId);
      if (!targetPos) return;

      const graphics = new Graphics();

      graphics.circle(0, 0, 4);
      graphics.fill({ color, alpha: 0.9 });

      graphics.x = sourcePos.x;
      graphics.y = sourcePos.y;

      particleContainer!.addChild(graphics);

      // Calculate control point for Bezier curve with random offset
      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Vary the position along the path (40-60% of the way)
      const pathPosition = 0.4 + Math.random() * 0.2;
      const midX = sourcePos.x + dx * pathPosition;
      const midY = sourcePos.y + dy * pathPosition;

      // Add perpendicular offset for curve variance (±25-50% of distance)
      const offsetAmount = (Math.random() - 0.5) * distance * (0.5 + Math.random() * 0.5);
      const controlX = midX + (-dy / distance) * offsetAmount;
      const controlY = midY + (dx / distance) * offsetAmount;

      particles.push({
        id: nextParticleId++,
        graphics,
        sourceX: sourcePos.x,
        sourceY: sourcePos.y,
        targetX: targetPos.x,
        targetY: targetPos.y,
        controlX,
        controlY,
        progress: 0,
        lifespan: 600, // 600ms travel time
        eventType,
      });
    });
  };

  const animate = (): void => {
    if (!app) return;

    const deltaTime = app.ticker.deltaMS;

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.progress += deltaTime / particle.lifespan;

      if (particle.progress >= 1) {
        // Remove particle
        particleContainer?.removeChild(particle.graphics);
        particle.graphics.destroy();
        particles.splice(i, 1);
      } else {
        // Update position along quadratic Bezier curve
        const t = easeOutCubic(particle.progress);
        const { x, y } = quadraticBezier(
          particle.sourceX, particle.sourceY,
          particle.controlX, particle.controlY,
          particle.targetX, particle.targetY,
          t
        );
        particle.graphics.x = x;
        particle.graphics.y = y;

        // Fade out
        particle.graphics.alpha = 0.8 * (1 - particle.progress);
      }
    }
  };

  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };

  const quadraticBezier = (
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    t: number
  ): { x: number; y: number } => {
    const t1 = 1 - t;
    return {
      x: t1 * t1 * x0 + 2 * t1 * t * x1 + t * t * x2,
      y: t1 * t1 * y0 + 2 * t1 * t * y1 + t * t * y2,
    };
  };

  onMount(async () => {
    if (!canvasRef) return;

    const system = createActorSystem();

    // Build graph from the actual ActorSystem
    buildGraphFromSystem(system);

    // Create PixiJS application
    app = new Application();
    await app.init({
      canvas: canvasRef,
      width: 800,
      height: 450,
      backgroundColor: 0x0a0a0a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Create particle container (dynamic) - add first so it renders behind
    particleContainer = new Container();
    app.stage.addChild(particleContainer);

    // Create graph container (static) - add second so it renders on top
    graphContainer = new Container();
    app.stage.addChild(graphContainer);

    // Draw the actor graph
    drawGraph();

    // Set up message monitor
    console.log('[MessageFlowViz] Setting up message monitor');
    system.setMessageMonitor((event: MessageWithTargets) => {
      console.log('[MessageFlowViz] Message received:', event);
      createParticle(event);
    });

    // Start animation loop
    app.ticker.add(animate);
    console.log('[MessageFlowViz] Initialization complete');
  });

  onCleanup(() => {
    if (app) {
      const system = createActorSystem();
      system.setMessageMonitor(undefined);

      // Clean up all particles
      particles.forEach(particle => {
        particle.graphics.destroy();
      });
      particles = [];

      app.destroy(true);
      app = null;
    }
  });

  return (
    <div class="message-flow-viz">
      <canvas ref={canvasRef} />
      <div class="event-legend">
        <div class="legend-item">
          <span class="legend-dot legend-custom" />
          <span class="legend-label">Custom Events</span>
        </div>
        <div class="legend-item">
          <span class="legend-dot legend-state" />
          <span class="legend-label">State Events</span>
        </div>
        <div class="legend-item">
          <span class="legend-dot legend-system" />
          <span class="legend-label">System Events</span>
        </div>
      </div>
    </div>
  );
}
