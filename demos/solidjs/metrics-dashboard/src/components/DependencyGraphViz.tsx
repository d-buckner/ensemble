import { createActor } from '@d-buckner/ensemble-solidjs';
import * as d3 from 'd3';
import { onMount, onCleanup, createEffect } from 'solid-js';
import { GeneratorToken } from '../tokens';


interface GraphNode {
  id: string;
  name: string;
  thread: string;
  threadType: 'main' | 'worker';
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

export function DependencyGraphViz() {
  let svgRef: SVGSVGElement | undefined;
  const generator = createActor(GeneratorToken);

  const nodes: GraphNode[] = [
    { id: 'generator', name: 'MetricGeneratorActor', thread: 'worker-1', threadType: 'worker' },
    { id: 'statistics', name: 'StatisticsActor', thread: 'worker-2', threadType: 'worker' },
    { id: 'anomaly', name: 'AnomalyDetectionActor', thread: 'worker-2', threadType: 'worker' },
    { id: 'dashboard', name: 'DashboardActor', thread: 'main', threadType: 'main' },
    { id: 'ui', name: 'UI (You are here)', thread: 'main thread', threadType: 'main' }
  ];

  const links: GraphLink[] = [
    { source: 'generator', target: 'statistics' },
    { source: 'statistics', target: 'anomaly' },
    { source: 'statistics', target: 'dashboard' },
    { source: 'anomaly', target: 'ui' },
    { source: 'dashboard', target: 'ui' }
  ];

  let animationInterval: number | null = null;

  const animateMessage = (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, link: GraphLink) => {
    const nodePositions = new Map<string, { x: number; y: number }>();
    const width = 800;
    const nodeRadius = 60;

    nodePositions.set('generator', { x: width / 2, y: 80 });
    nodePositions.set('statistics', { x: width / 2, y: 180 });
    nodePositions.set('anomaly', { x: width / 2 - 150, y: 280 });
    nodePositions.set('dashboard', { x: width / 2 + 150, y: 280 });
    nodePositions.set('ui', { x: width / 2, y: 400 });

    const sourcePos = nodePositions.get(link.source)!;
    const targetPos = nodePositions.get(link.target)!;

    // Create particle
    const particle = svg.select('g.particles')
      .append('circle')
      .attr('cx', sourcePos.x)
      .attr('cy', sourcePos.y + nodeRadius / 2)
      .attr('r', 4)
      .attr('fill', '#667eea')
      .attr('opacity', 0);

    // Fade in, move, and fade out
    particle
      .transition()
      .duration(100)
      .attr('opacity', 1)
      .transition()
      .duration(600)
      .ease(d3.easeCubicInOut)
      .attr('cx', targetPos.x)
      .attr('cy', targetPos.y - nodeRadius / 2)
      .transition()
      .duration(100)
      .attr('opacity', 0)
      .remove();
  };

  onMount(() => {
    if (!svgRef) return;

    const width = 800;
    const nodeRadius = 60;

    const svg = d3.select(svgRef);
    svg.selectAll('*').remove();

    // Create container group
    const g = svg.append('g');

    // Create particles layer
    svg.append('g').attr('class', 'particles');

    // Define arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', nodeRadius + 20)
      .attr('refY', 0)
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#667eea');

    // Create hierarchical layout
    const nodePositions = new Map<string, { x: number; y: number }>();
    nodePositions.set('generator', { x: width / 2, y: 80 });
    nodePositions.set('statistics', { x: width / 2, y: 180 });
    nodePositions.set('anomaly', { x: width / 2 - 150, y: 280 });
    nodePositions.set('dashboard', { x: width / 2 + 150, y: 280 });
    nodePositions.set('ui', { x: width / 2, y: 400 });

    // Draw links
    const linkElements = g.selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('x1', d => nodePositions.get(d.source)!.x)
      .attr('y1', d => nodePositions.get(d.source)!.y + nodeRadius / 2)
      .attr('x2', d => nodePositions.get(d.target)!.x)
      .attr('y2', d => nodePositions.get(d.target)!.y - nodeRadius / 2)
      .attr('stroke', '#667eea')
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#arrowhead)')
      .attr('opacity', 0.6);

    // Create node groups
    const nodeGroups = g.selectAll('g.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => {
        const pos = nodePositions.get(d.id)!;
        return `translate(${pos.x},${pos.y})`;
      });

    // Add node rectangles
    nodeGroups.append('rect')
      .attr('x', -nodeRadius * 1.8)
      .attr('y', -nodeRadius / 2)
      .attr('width', nodeRadius * 3.6)
      .attr('height', nodeRadius)
      .attr('rx', 8)
      .attr('fill', d => d.id === 'ui' ? 'rgba(102, 126, 234, 0.2)' : '#0a0a0a')
      .attr('stroke', d => d.id === 'ui' ? '#667eea' : '#333')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('stroke', '#667eea')
          .attr('stroke-width', 3);
      })
      .on('mouseleave', function(_event, d) {
        if (d.id !== 'ui') {
          d3.select(this)
            .transition()
            .duration(200)
            .attr('stroke', '#333')
            .attr('stroke-width', 2);
        }
      });

    // Add node names
    nodeGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', -5)
      .attr('fill', '#e0e0e0')
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .text(d => d.name);

    // Add thread badges
    nodeGroups.append('rect')
      .attr('x', d => -(d.thread.length * 3.5 + 8))
      .attr('y', 8)
      .attr('width', d => d.thread.length * 7 + 16)
      .attr('height', 20)
      .attr('rx', 4)
      .attr('fill', d => d.threadType === 'main' ? '#667eea' : '#4caf50');

    nodeGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 21)
      .attr('fill', 'white')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(d => d.thread.toUpperCase());

    // Add subtle animation on mount
    nodeGroups
      .attr('opacity', 0)
      .transition()
      .duration(500)
      .delay((_d, i) => i * 100)
      .attr('opacity', 1);

    linkElements
      .attr('opacity', 0)
      .transition()
      .duration(500)
      .delay(300)
      .attr('opacity', 0.6);
  });

  // Animate messages flowing through the graph when generating
  createEffect(() => {
    if (!svgRef) return;

    const isGenerating = generator.state.isGenerating();

    if (isGenerating && animationInterval === null) {
      const svg = d3.select(svgRef);

      // Start animation loop
      animationInterval = setInterval(() => {
        // Animate full pipeline sequence
        animateMessage(svg, { source: 'generator', target: 'statistics' });

        setTimeout(() => {
          animateMessage(svg, { source: 'statistics', target: 'anomaly' });
          animateMessage(svg, { source: 'statistics', target: 'dashboard' });
        }, 200);

        setTimeout(() => {
          animateMessage(svg, { source: 'anomaly', target: 'ui' });
          animateMessage(svg, { source: 'dashboard', target: 'ui' });
        }, 400);
      }, 100) as unknown as number;
    } else if (!isGenerating && animationInterval !== null) {
      clearInterval(animationInterval);
      animationInterval = null;
    }
  });

  onCleanup(() => {
    if (animationInterval !== null) {
      clearInterval(animationInterval);
    }
  });

  return (
    <div class="graph-viz-container">
      <svg ref={svgRef} viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet" />
    </div>
  );
}
