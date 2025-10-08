import { createEffect, onCleanup, onMount } from 'solid-js';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface SimpleLineChartProps {
  data: Array<{ timestamp: number; value: number }>;
  color: string;
}

export function SimpleLineChart(props: SimpleLineChartProps) {
  let containerRef: HTMLDivElement | undefined;
  let chart: uPlot | undefined;

  onMount(() => {
    if (!containerRef) return;

    const opts: uPlot.Options = {
      width: containerRef.clientWidth,
      height: 150,
      series: [
        {},
        {
          stroke: props.color,
          width: 2,
          points: { show: false }
        }
      ],
      axes: [
        { show: false }, // Hide x-axis
        { show: false }  // Hide y-axis
      ],
      legend: { show: false },
      cursor: { show: false },
      scales: {
        x: { time: false },
        y: { auto: true }
      },
      padding: [4, 4, 4, 4]
    };

    // Initialize with empty data
    const data: uPlot.AlignedData = [[], []];
    chart = new uPlot(opts, data, containerRef);
  });

  createEffect(() => {
    if (!chart || props.data.length === 0) return;

    // Convert to uPlot format: [x[], y[]]
    const timestamps = props.data.map((_, i) => i);
    const values = props.data.map(d => d.value);

    chart.setData([timestamps, values]);
  });

  onCleanup(() => {
    if (chart) {
      chart.destroy();
    }
  });

  return (
    <div class="chart-container">
      <div ref={containerRef} class="uplot-chart" />
    </div>
  );
}
