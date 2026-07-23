import { extent, line, max, scaleLinear } from 'd3'

import type { MetricHistoryPoint } from '../../types/simulation'

type MetricTimeSeriesProps = { history: MetricHistoryPoint[] }

const WIDTH = 420
const HEIGHT = 122
const MARGIN = { top: 14, right: 16, bottom: 25, left: 46 }

const panels = [
  { key: 'avg_delay_ms', label: '平均时延', unit: 'ms', color: '#60a5fa', factor: 1 },
  { key: 'delivery_rate', label: '消息覆盖率', unit: '%', color: '#34d399', factor: 100 },
  { key: 'comm_overhead', label: '通信开销', unit: 'x', color: '#fbbf24', factor: 1 },
] as const

export function MetricTimeSeries({ history }: MetricTimeSeriesProps) {
  const timestamps = extent(history, (point) => point.timestamp)
  const xStart = timestamps[0] ?? 0
  const xEnd = timestamps[1] === undefined || timestamps[1] === xStart ? xStart + 1 : timestamps[1]
  const x = scaleLinear().domain([xStart, xEnd]).range([MARGIN.left, WIDTH - MARGIN.right])

  return (
    <section className="timeseries-card" aria-labelledby="timeseries-heading">
      <div className="timeseries-heading">
        <div>
          <p className="eyebrow">LAST 30 STEPS</p>
          <h2 id="timeseries-heading">指标时间序列</h2>
        </div>
        <span>同步时间轴 · 最近 {history.length}/30 点</span>
      </div>
      <div className="timeseries-grid">
        {panels.map((panel) => {
          const values = history.map((point) => point[panel.key] * panel.factor)
          const top = panel.key === 'delivery_rate' ? 100 : Math.max(1, (max(values) ?? 0) * 1.15)
          const y = scaleLinear().domain([0, top]).nice().range([HEIGHT - MARGIN.bottom, MARGIN.top])
          const path = line<MetricHistoryPoint>()
            .x((point) => x(point.timestamp))
            .y((point) => y(point[panel.key] * panel.factor))(history)

          return (
            <article key={panel.key} className="timeseries-panel">
              <h3>{panel.label}</h3>
              {history.length === 0 ? (
                <p className="panel-empty">运行仿真后开始记录。</p>
              ) : (
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${panel.label}最近${history.length}个时间步趋势`}>
                  <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className="chart-axis" />
                  <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} className="chart-axis" />
                  <text x={MARGIN.left - 7} y={MARGIN.top + 4} textAnchor="end" className="chart-tick">{top.toFixed(panel.key === 'comm_overhead' ? 1 : 0)}</text>
                  <text x={MARGIN.left - 7} y={HEIGHT - MARGIN.bottom + 4} textAnchor="end" className="chart-tick">0</text>
                  <text x={MARGIN.left} y={HEIGHT - 6} className="chart-tick">{xStart.toFixed(1)}s</text>
                  <text x={WIDTH - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="chart-tick">{xEnd.toFixed(1)}s</text>
                  <path d={path ?? ''} fill="none" stroke={panel.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
                  {history.length === 1 && (
                    <circle cx={x(history[0].timestamp)} cy={y(history[0][panel.key] * panel.factor)} r={4} fill={panel.color} />
                  )}
                  <text x={WIDTH - MARGIN.right} y={MARGIN.top + 4} textAnchor="end" className="chart-current" fill={panel.color}>
                    {(values.at(-1) ?? 0).toFixed(1)} {panel.unit}
                  </text>
                </svg>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
