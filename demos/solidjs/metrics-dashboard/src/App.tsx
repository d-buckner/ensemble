import { createActor } from '@d-buckner/ensemble-solidjs';
import { createSignal, onCleanup, For, Show } from 'solid-js';
import { AnimatedNumber } from './components/AnimatedNumber';
import { MessageFlowViz } from './components/MessageFlowViz';
import { SimpleLineChart } from './components/SimpleLineChart';
import { GeneratorToken, DashboardToken, AnomalyDetectionToken } from './tokens';
import './style.css';


export function App() {
  const generator = createActor(GeneratorToken);
  const dashboard = createActor(DashboardToken);
  const anomalyDetection = createActor(AnomalyDetectionToken);

  const [fps, setFps] = createSignal(60);

  // FPS counter
  let frameCount = 0;
  let lastTime = performance.now();
  let animationFrameId: number;

  const measureFPS = () => {
    const currentTime = performance.now();
    frameCount++;

    if (currentTime - lastTime >= 1000) {
      const currentFps = Math.round((frameCount * 1000) / (currentTime - lastTime));
      setFps(currentFps);
      frameCount = 0;
      lastTime = currentTime;
    }

    animationFrameId = requestAnimationFrame(measureFPS);
  };

  animationFrameId = requestAnimationFrame(measureFPS);
  onCleanup(() => cancelAnimationFrame(animationFrameId));

  // Auto-start streaming on mount
  generator.actions.start();

  const handleStart = () => generator.actions.start();
  const handleStop = () => generator.actions.stop();
  const handleBatchSizeChange = (value: number) => generator.actions.setBatchSize(value);
  const handleThroughputChange = (throughput: number) => generator.actions.setThroughput(throughput);

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return '#4caf50';
    if (fps >= 30) return '#ff9800';
    return '#f44336';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return '#f44336';
      case 'medium': return '#ff9800';
      case 'low': return '#ffc107';
      default: return '#888';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div class="app">
      <h1 class="app-title">Ensemble Demo: Real-Time Metrics</h1>

      {/* Controls */}
      <div class="controls">
        <button
          class="btn btn-primary"
          onClick={handleStart}
          disabled={generator.state.isGenerating()}
        >
          Start Streaming
        </button>
        <button
          class="btn btn-secondary"
          onClick={handleStop}
          disabled={!generator.state.isGenerating()}
        >
          Stop
        </button>
        <div class="batch-size-control">
          <label for="batch-size">
            Batch Size: <span class="batch-size-value">{generator.state.batchSize()}</span>
          </label>
          <input
            id="batch-size"
            type="range"
            min="1"
            max="100"
            value={generator.state.batchSize()}
            onInput={(e) => handleBatchSizeChange(parseInt(e.currentTarget.value))}
          />
        </div>
        <div class="batch-size-control">
          <label for="throughput">
            Throughput: <span class="batch-size-value">{generator.state.throughput()} metric/s</span>
          </label>
          <input
            id="throughput"
            type="range"
            min="1"
            max="1000"
            value={generator.state.throughput()}
            onInput={(e) => handleThroughputChange(parseInt(e.currentTarget.value))}
          />
        </div>
        <div class="control-info">
          <span>Batches: <span style={{'font-variant-numeric':'tabular-nums'}}>{generator.state.batchesGenerated()}</span></span>
          <span>Metrics: <span style={{'font-variant-numeric':'tabular-nums'}}>{generator.state.metricsGenerated()}</span></span>
        </div>
      </div>

      {/* Charts */}
      <Show when={dashboard.state.chartData().cpuSeries.length > 0}>
        <div class="charts-section">
          <div class="chart-card">
            <h3>CPU Usage</h3>
            <SimpleLineChart data={dashboard.state.chartData().cpuSeries} color="#2196f3" />
          </div>

          <div class="chart-card">
            <h3>Memory Usage</h3>
            <SimpleLineChart data={dashboard.state.chartData().memorySeries} color="#4caf50" />
          </div>

          <div class="chart-card">
            <h3>Latency (P95)</h3>
            <SimpleLineChart data={dashboard.state.chartData().latencySeries} color="#ff9800" />
          </div>

          <div class="chart-card">
            <h3>Throughput</h3>
            <SimpleLineChart data={dashboard.state.chartData().throughputSeries} color="#9c27b0" />
          </div>
        </div>
      </Show>

      {/* Performance Metrics */}
      <div class="performance-section">
        <h3>Performance Metrics</h3>
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">FPS</div>
            <div class="metric-value" style={{ color: getFpsColor(fps()) }}>
              {fps()}
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Generating</div>
            <div class="metric-value">
              {generator.state.isGenerating() ? 'Yes' : 'No'}
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Monitoring</div>
            <div class="metric-value">
              {anomalyDetection.state.isMonitoring() ? 'Yes' : 'No'}
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Anomalies</div>
            <div class="metric-value" style={{ color: anomalyDetection.state.anomaliesDetected() > 0 ? '#f44336' : '#4caf50' }}>
              {anomalyDetection.state.anomaliesDetected()}
            </div>
          </div>
        </div>
      </div>

      {/* Message Flow Visualization */}
      <div class="message-flow-section">
        <h3>Real-Time Message Flow</h3>
        <MessageFlowViz />
      </div>

      {/* Current Metrics */}
      <Show when={dashboard.state.currentMetrics()}>
        {(metrics) => (
          <div class="current-metrics">
            <h3>Current Metrics</h3>
            <div class="metrics-grid">
              <div class="stat-card">
                <h4>CPU</h4>
                <div class="stat-value"><AnimatedNumber value={metrics().cpu.overall} decimals={1} suffix="%" /></div>
                <div class="stat-detail">σ: <AnimatedNumber value={metrics().cpu.stdDev} decimals={1} /></div>
              </div>
              <div class="stat-card">
                <h4>Memory</h4>
                <div class="stat-value"><AnimatedNumber value={metrics().memory.usedPercent} decimals={1} suffix="%" /></div>
                <div class="stat-detail">Pressure: <AnimatedNumber value={metrics().memory.pressure * 100} decimals={0} suffix="%" /></div>
              </div>
              <div class="stat-card">
                <h4>Latency P95</h4>
                <div class="stat-value"><AnimatedNumber value={metrics().latency.p95} decimals={1} suffix="ms" /></div>
                <div class="stat-detail">Mean: <AnimatedNumber value={metrics().latency.mean} decimals={1} suffix="ms" /></div>
              </div>
              <div class="stat-card">
                <h4>Throughput</h4>
                <div class="stat-value"><AnimatedNumber value={metrics().throughput.requestsPerSec} decimals={0} suffix="/s" /></div>
                <div class="stat-detail">Error: <AnimatedNumber value={metrics().throughput.errorRate} decimals={1} suffix="%" /></div>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Anomalies */}
      <Show when={dashboard.state.recentAnomalies().length > 0}>
        <div class="anomalies-section">
          <h3>Recent Anomalies</h3>
          <div class="anomaly-list">
            <For each={dashboard.state.recentAnomalies()}>
              {(anomaly) => (
                <div class="anomaly-card" style={{ 'border-left': `4px solid ${getSeverityColor(anomaly.severity)}` }}>
                  <div class="anomaly-header">
                    <span class="anomaly-type">{anomaly.type.replace(/_/g, ' ').toUpperCase()}</span>
                    <span class="anomaly-time">{formatTimestamp(anomaly.timestamp)}</span>
                  </div>
                  <div class="anomaly-message">{anomaly.message}</div>
                  <div class="anomaly-severity">Severity: {anomaly.severity}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
