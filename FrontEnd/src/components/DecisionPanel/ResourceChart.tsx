import { max, scaleLinear } from 'd3'

import type { SimulationDecision } from '../../types/simulation'

type ResourceChartProps = { decision: SimulationDecision | null }

export function ResourceChart({ decision }: ResourceChartProps) {
  const selected = decision?.selected_vehicles ?? decision?.selected_receivers ?? []
  const allocations = selected.map((id, index) => ({
    id,
    value: decision?.bandwidth_allocation[index] ?? 0,
  }))
  const width = 280
  const rowHeight = 34
  const labelWidth = 76
  const chartWidth = width - labelWidth - 18
  const x = scaleLinear()
    .domain([0, Math.max(1, max(allocations, (item) => item.value) ?? 1)])
    .range([0, chartWidth])

  if (allocations.length === 0) {
    return <p className="panel-empty">当前时间步未分配通信资源。</p>
  }

  return (
    <div className="resource-chart-scroll">
      <svg
        className="resource-chart"
        viewBox={`0 0 ${width} ${allocations.length * rowHeight + 8}`}
        role="img"
        aria-labelledby="resource-chart-title resource-chart-description"
      >
        <title id="resource-chart-title">接收车辆带宽分配</title>
        <desc id="resource-chart-description">横条越长表示PPO策略分配的相对通信资源越多。</desc>
        {allocations.map((item, index) => {
          const y = index * rowHeight + 4
          return (
            <g key={item.id} transform={`translate(0 ${y})`}>
              <text x={0} y={17} className="resource-label">{item.id}</text>
              <rect x={labelWidth} y={2} width={chartWidth} height={20} rx={5} className="resource-track" />
              <rect x={labelWidth} y={2} width={x(item.value)} height={20} rx={5} className="resource-bar" />
              <text x={labelWidth + Math.min(x(item.value) + 6, chartWidth - 30)} y={17} className="resource-value">
                {item.value.toFixed(2)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
