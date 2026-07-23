import type { SimulationMetrics } from '../../types/simulation'

type RealtimeMetricsProps = { metrics: SimulationMetrics }

export function RealtimeMetrics({ metrics }: RealtimeMetricsProps) {
  const values = [
    { label: '当前平均时延', value: `${metrics.avg_delay_ms.toFixed(1)} ms`, tone: 'blue' },
    { label: '消息送达率', value: `${(metrics.delivery_rate * 100).toFixed(1)}%`, tone: 'green' },
    { label: '通信开销', value: `${metrics.comm_overhead.toFixed(2)}x`, tone: 'orange' },
  ]
  return (
    <section className="metrics-grid" aria-label="实时通信指标">
      {values.map((metric) => (
        <article key={metric.label} className={`metric-card metric-card--${metric.tone}`}>
          <p>{metric.label}</p><strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  )
}
