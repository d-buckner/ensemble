import { Actor, effect, thread } from '@d-buckner/ensemble-core';
import type { StatisticsActor, ProcessedBatch, ProcessedMetrics } from './StatisticsActor';
import type { ActorClient } from '@d-buckner/ensemble-core';


export interface Anomaly {
  timestamp: number;
  type: 'cpu_spike' | 'memory_leak' | 'latency_outlier' | 'error_spike' | 'slow_queries';
  severity: 'low' | 'medium' | 'high';
  message: string;
  value: number;
  threshold: number;
}

export interface AnomalyDetectionState {
  isMonitoring: boolean;
  anomaliesDetected: number;
  recentAnomalies: Anomaly[];
}

export interface AnomalyDetectionEvents {
  latestAnomaly: Anomaly;
}

interface AnomalyDetectionDeps {
  statistics: ActorClient<StatisticsActor>;
}

/**
 * AnomalyDetectionActor monitors processed metrics for anomalies.
 *
 * Demonstrates:
 * - Statistical anomaly detection (z-score, trend analysis)
 * - Event-driven alerts
 * - Historical state tracking for trend detection
 * - Cross-worker event communication via MainBus
 *
 * Runs on WORKER-2 alongside StatisticsActor for efficient event communication
 */
@thread('worker-2')
export class AnomalyDetectionActor extends Actor<AnomalyDetectionState, AnomalyDetectionEvents> {
  static readonly initialState: AnomalyDetectionState = {
    isMonitoring: false,
    anomaliesDetected: 0,
    recentAnomalies: []
  };

  protected declare deps: AnomalyDetectionDeps;

  // Historical data for trend detection
  private cpuHistory: number[] = [];
  private memoryHistory: number[] = [];
  private latencyHistory: number[] = [];
  private errorRateHistory: number[] = [];

  private readonly historySize = 100;
  private readonly zScoreThreshold = 2.5; // Standard deviations

  constructor() {
    super(AnomalyDetectionActor.initialState);
  }

  onInit(): void {
    this.setState(draft => {
      draft.isMonitoring = true;
    });
  }

  @effect('statistics.processedBatch')
  analyzeMetrics(batch: ProcessedBatch): void {
    batch.metrics.forEach(metric => {
      // Update history
      this.updateHistory(this.cpuHistory, metric.cpu.overall);
      this.updateHistory(this.memoryHistory, metric.memory.usedPercent);
      this.updateHistory(this.latencyHistory, metric.latency.p95);
      this.updateHistory(this.errorRateHistory, metric.throughput.errorRate);

      // Detect anomalies
      this.detectCpuSpike(metric);
      this.detectMemoryLeak(metric);
      this.detectLatencyOutlier(metric);
      this.detectErrorSpike(metric);
      this.detectSlowQueries(metric);
    });
  }

  private detectCpuSpike(metric: ProcessedMetrics): void {
    if (this.cpuHistory.length < 10) return;

    const zScore = this.calculateZScore(metric.cpu.overall, this.cpuHistory);
    if (zScore > this.zScoreThreshold) {
      const anomaly: Anomaly = {
        timestamp: metric.timestamp,
        type: 'cpu_spike',
        severity: zScore > 3 ? 'high' : 'medium',
        message: `CPU spike detected: ${metric.cpu.overall.toFixed(1)}% (${zScore.toFixed(1)}σ above mean)`,
        value: metric.cpu.overall,
        threshold: this.calculateMean(this.cpuHistory) + this.zScoreThreshold * this.calculateStdDev(this.cpuHistory)
      };

      this.recordAnomaly(anomaly);
    }
  }

  private detectMemoryLeak(metric: ProcessedMetrics): void {
    if (this.memoryHistory.length < 20) return;

    // Check for continuously rising trend
    const recentMemory = this.memoryHistory.slice(-20);
    const trend = this.calculateTrend(recentMemory);

    if (trend > 0.5 && metric.memory.usedPercent > 70) {
      const anomaly: Anomaly = {
        timestamp: metric.timestamp,
        type: 'memory_leak',
        severity: metric.memory.usedPercent > 85 ? 'high' : 'medium',
        message: `Potential memory leak: ${metric.memory.usedPercent.toFixed(1)}% and rising (trend: ${trend.toFixed(2)})`,
        value: metric.memory.usedPercent,
        threshold: 70
      };

      this.recordAnomaly(anomaly);
    }
  }

  private detectLatencyOutlier(metric: ProcessedMetrics): void {
    if (this.latencyHistory.length < 10) return;

    const zScore = this.calculateZScore(metric.latency.p95, this.latencyHistory);
    if (zScore > this.zScoreThreshold) {
      const anomaly: Anomaly = {
        timestamp: metric.timestamp,
        type: 'latency_outlier',
        severity: zScore > 3 ? 'high' : metric.latency.p95 > 500 ? 'medium' : 'low',
        message: `Latency spike: P95 at ${metric.latency.p95.toFixed(1)}ms (${zScore.toFixed(1)}σ above mean)`,
        value: metric.latency.p95,
        threshold: this.calculateMean(this.latencyHistory) + this.zScoreThreshold * this.calculateStdDev(this.latencyHistory)
      };

      this.recordAnomaly(anomaly);
    }
  }

  private detectErrorSpike(metric: ProcessedMetrics): void {
    if (this.errorRateHistory.length < 10) return;

    const zScore = this.calculateZScore(metric.throughput.errorRate, this.errorRateHistory);
    if (zScore > this.zScoreThreshold && metric.throughput.errorRate > 1) {
      const anomaly: Anomaly = {
        timestamp: metric.timestamp,
        type: 'error_spike',
        severity: metric.throughput.errorRate > 10 ? 'high' : 'medium',
        message: `Error rate spike: ${metric.throughput.errorRate.toFixed(1)}% (${zScore.toFixed(1)}σ above mean)`,
        value: metric.throughput.errorRate,
        threshold: this.calculateMean(this.errorRateHistory) + this.zScoreThreshold * this.calculateStdDev(this.errorRateHistory)
      };

      this.recordAnomaly(anomaly);
    }
  }

  private detectSlowQueries(metric: ProcessedMetrics): void {
    if (metric.database.slowQueries > 5) {
      const anomaly: Anomaly = {
        timestamp: metric.timestamp,
        type: 'slow_queries',
        severity: metric.database.slowQueries > 10 ? 'high' : 'medium',
        message: `${metric.database.slowQueries} slow database queries detected (P95: ${metric.database.p95QueryTime.toFixed(1)}ms)`,
        value: metric.database.slowQueries,
        threshold: 5
      };

      this.recordAnomaly(anomaly);
    }
  }

  private recordAnomaly(anomaly: Anomaly): void {
    this.emit('latestAnomaly', anomaly);

    this.setState(draft => {
      draft.anomaliesDetected++;
      draft.recentAnomalies = [anomaly, ...draft.recentAnomalies].slice(0, 10);
    });
  }

  private updateHistory(history: number[], value: number): void {
    history.push(value);
    if (history.length > this.historySize) {
      history.shift();
    }
  }

  private calculateZScore(value: number, history: number[]): number {
    const mean = this.calculateMean(history);
    const stdDev = this.calculateStdDev(history);
    return stdDev === 0 ? 0 : (value - mean) / stdDev;
  }

  private calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStdDev(values: number[]): number {
    const mean = this.calculateMean(values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateTrend(values: number[]): number {
    // Simple linear regression slope
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }
}
