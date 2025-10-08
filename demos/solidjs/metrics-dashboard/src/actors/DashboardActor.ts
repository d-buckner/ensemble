import { Actor } from '@d-buckner/ensemble-core';
import type { AnomalyDetectionActor, Anomaly } from './AnomalyDetectionActor';
import type { StatisticsActor, ProcessedBatch, ProcessedMetrics } from './StatisticsActor';
import type { ActorClient } from '@d-buckner/ensemble-core';


export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ChartData {
  cpuSeries: TimeSeriesPoint[];
  memorySeries: TimeSeriesPoint[];
  latencySeries: TimeSeriesPoint[];
  throughputSeries: TimeSeriesPoint[];
  errorRateSeries: TimeSeriesPoint[];
}

export interface DashboardState {
  chartData: ChartData;
  currentMetrics: ProcessedMetrics | null;
  recentAnomalies: Anomaly[];
  windowSize: number; // Number of data points to keep
}

interface DashboardDeps {
  statistics: ActorClient<StatisticsActor>;
  anomalyDetection: ActorClient<AnomalyDetectionActor>;
}

/**
 * DashboardActor prepares chart-ready data for the UI.
 *
 * Demonstrates:
 * - Time-series data windowing
 * - Multiple data source aggregation
 * - Main thread data preparation (close to UI)
 * - Minimal state updates for smooth rendering
 *
 * Runs on MAIN THREAD for direct UI access
 */
export class DashboardActor extends Actor<DashboardState> {
  static readonly initialState: DashboardState = {
    chartData: {
      cpuSeries: [],
      memorySeries: [],
      latencySeries: [],
      throughputSeries: [],
      errorRateSeries: []
    },
    currentMetrics: null,
    recentAnomalies: [],
    windowSize: 300 // Keep last 300 data points (~30 seconds at 10Hz sampling)
  };

  protected declare deps: DashboardDeps;
  private readonly samplingRate = 10; // Sample every Nth metric to reduce chart density
  private buffer: ProcessedMetrics[] = [];
  private animationFrameId: number | null = null;
  private readonly pointsPerFrame = 2; // Add 2 points per frame at 60fps = ~120 points/sec

  constructor() {
    super(DashboardActor.initialState);
  }

  onInit(): void {
    console.log('[DashboardActor] onInit called, subscribing to processedBatch and latestAnomaly');
    this.deps.statistics.on('processedBatch', this.bufferBatch.bind(this));
    this.deps.anomalyDetection.on('latestAnomaly', this.addAnomaly.bind(this));
    // Animation starts on-demand when data arrives
  }

  onDestroy(): void {
    this.deps.statistics.off('processedBatch', this.bufferBatch.bind(this));
    this.deps.anomalyDetection.off('latestAnomaly', this.addAnomaly.bind(this));
    this.stopAnimation();
  }

  private startAnimation(): void {
    if (this.animationFrameId !== null) return; // Already running

    const animate = () => {
      const hadData = this.drainBuffer();

      // Continue animation only if there's still data in the buffer
      if (hadData && this.buffer.length > 0) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.animationFrameId = null;
      }
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private stopAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private bufferBatch(batch: ProcessedBatch | null): void {
    console.log('[DashboardActor] bufferBatch called with:', batch ? `${batch.metrics.length} metrics` : 'null');
    if (!batch) return;

    // Sample metrics to avoid overwhelming the buffer
    // Take every Nth metric plus the last one (most recent)
    const sampledMetrics = batch.metrics.filter((_, i) =>
      i % this.samplingRate === 0 || i === batch.metrics.length - 1
    );

    // Add to buffer for smooth consumption
    this.buffer.push(...sampledMetrics);

    // Keep buffer size reasonable (max 500 points = ~5 seconds of data)
    if (this.buffer.length > 500) {
      this.buffer = this.buffer.slice(-500);
    }

    // Start animation if not already running
    this.startAnimation();
  }

  private drainBuffer(): boolean {
    if (this.buffer.length === 0) return false;

    // Take up to pointsPerFrame metrics from buffer
    const count = Math.min(this.pointsPerFrame, this.buffer.length);
    const metricsToAdd = this.buffer.splice(0, count);

    this.setState(draft => {
      // Update current metrics to the latest we're adding
      draft.currentMetrics = metricsToAdd[metricsToAdd.length - 1];

      // Add points to time series
      for (const metric of metricsToAdd) {
        this.addPoint(draft.chartData.cpuSeries, metric.timestamp, metric.cpu.overall);
        this.addPoint(draft.chartData.memorySeries, metric.timestamp, metric.memory.usedPercent);
        this.addPoint(draft.chartData.latencySeries, metric.timestamp, metric.latency.p95);
        this.addPoint(draft.chartData.throughputSeries, metric.timestamp, metric.throughput.requestsPerSec);
        this.addPoint(draft.chartData.errorRateSeries, metric.timestamp, metric.throughput.errorRate);
      }

      // Trim to window size
      this.trimSeries(draft.chartData.cpuSeries, draft.windowSize);
      this.trimSeries(draft.chartData.memorySeries, draft.windowSize);
      this.trimSeries(draft.chartData.latencySeries, draft.windowSize);
      this.trimSeries(draft.chartData.throughputSeries, draft.windowSize);
      this.trimSeries(draft.chartData.errorRateSeries, draft.windowSize);
    });

    return true;
  }

  private addAnomaly(anomaly: Anomaly | null): void {
    if (!anomaly) return;
    this.setState(draft => {
      draft.recentAnomalies = [anomaly, ...draft.recentAnomalies].slice(0, 5);
    });
  }

  private addPoint(series: TimeSeriesPoint[], timestamp: number, value: number): void {
    series.push({ timestamp, value });
  }

  private trimSeries(series: TimeSeriesPoint[], maxSize: number): void {
    if (series.length > maxSize) {
      series.splice(0, series.length - maxSize);
    }
  }
}
