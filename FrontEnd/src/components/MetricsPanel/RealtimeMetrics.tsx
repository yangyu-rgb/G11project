import type { RealtimeMetricValues } from '../../types/simulation'

type RealtimeMetricsProps = { metrics: RealtimeMetricValues }

export function RealtimeMetrics({ metrics }: RealtimeMetricsProps) {
  const values = [
    { label: '当前时延', value: `${metrics.latencyMs} ms`, tone: 'blue' },
    { label: '关键车辆覆盖率', value: `${metrics.coveragePercent}%`, tone: 'green' },
    { label: '通信开销', value: `${metrics.communicationOverhead.toFixed(1)}x`, tone: 'orange' },
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
