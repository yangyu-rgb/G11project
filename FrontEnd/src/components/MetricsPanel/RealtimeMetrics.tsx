import type { MetricHistoryPoint, SimulationMetrics } from '../../types/simulation'
import { TimeSeriesChart } from './TimeSeriesChart'

type RealtimeMetricsProps = { metrics: SimulationMetrics; history?: MetricHistoryPoint[] }

export function RealtimeMetrics({ metrics, history = [] }: RealtimeMetricsProps) {
  const values = [
    { label: 'Current Average Latency', value: `${metrics.avg_delay_ms.toFixed(1)} ms`, tone: 'blue' },
    { label: 'Message Delivery Rate', value: `${(metrics.delivery_rate * 100).toFixed(1)}%`, tone: 'green' },
    { label: 'Communication Overhead', value: `${metrics.comm_overhead.toFixed(2)}x`, tone: 'orange' },
  ]
  return (
    <div className="metrics-panel">
      <section className="metrics-grid" aria-label="Real-time communication metrics">
        {values.map((metric) => (
          <article key={metric.label} className={`metric-card metric-card--${metric.tone}`}>
            <p>{metric.label}</p><strong>{metric.value}</strong>
          </article>
        ))}
      </section>
      <TimeSeriesChart history={history} />
    </div>
  )
}
