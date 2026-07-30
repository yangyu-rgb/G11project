import {
  BarChart3, ChevronDown, ChevronUp, Database, GitCommitHorizontal,
  Network, Route, ScanSearch, ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { DemoResultsSummary, MetricEstimate } from '../../types/demoResults'
import type { ComparisonPair, ReceiverRelation, StateUpdateMessage } from '../../types/simulation'

export type DecisionStep = {
  index: number
  label: string
  title: string
  primary: string
  secondary: string
}

function totalBandwidth(update: StateUpdateMessage): number {
  return update.decision.bandwidth_fraction
    ?? update.decision.bandwidth_allocation.reduce((sum, value) => sum + value, 0)
}

// eslint-disable-next-line react-refresh/only-export-components
export function decisionPipelineData(update: StateUpdateMessage | undefined): DecisionStep[] {
  if (!update) return []
  const event = update.events[0]
  const topAttention = [...(update.attention_weights ?? [])]
    .sort((left, right) => right.weight - left.weight)[0]
  const selected = new Set(update.decision.selected_receivers)
  const delivered = update.messages.filter((message) => (
    selected.has(message.to) && message.status === 'success'
  )).length
  return [
    {
      index: 1, label: 'OBSERVATION', title: '车辆—事件状态',
      primary: `${update.vehicles.length} 辆车 · 严重度 ${(event?.severity ?? 0).toFixed(2)}`,
      secondary: '位置、速度、车道、事件等级组成结构化观测',
    },
    {
      index: 2, label: 'ENCODING', title: 'Transformer关系编码',
      primary: topAttention
        ? `最高关系权重 ${topAttention.vehicle_id} · ${(topAttention.weight * 100).toFixed(1)}%`
        : '车辆与事件的上下文关系向量',
      secondary: 'z = Transformer(Xvehicle, Xevent)；权重用于解释线索，不等同因果',
    },
    {
      index: 3, label: 'POLICY', title: 'PPO结构化动作',
      primary: `${update.decision.corridor_radius_m?.toFixed(0) ?? '—'} m · ${
        update.decision.corridor_lane_scope === 'same_and_adjacent' ? '同车道 + 相邻' : '仅同车道'}`,
      secondary: `a ~ πθ(a | z) · ${update.decision.priority.toUpperCase()}优先级 · ${(totalBandwidth(update) * 100).toFixed(0)}%带宽`,
    },
    {
      index: 4, label: 'OUTCOME', title: '接收集合与网络结果',
      primary: `${selected.size} 辆被选 · ${delivered}/${update.messages.length} 条成功送达`,
      secondary: `平均时延 ${update.metrics.avg_delay_ms.toFixed(1)} ms · 负载 ${update.metrics.comm_overhead.toFixed(2)}`,
    },
  ]
}

export function DecisionPipeline({ update, compact = false }: {
  update: StateUpdateMessage | undefined
  compact?: boolean
}) {
  const steps = decisionPipelineData(update)
  if (!steps.length) return null
  return <section className={`decision-pipeline ${compact ? 'decision-pipeline--compact' : ''}`}
    aria-label="AI四步决策链">
    <header><span>可审计AI决策链</span><code>z → πθ → a</code></header>
    <div className="decision-pipeline__steps">
      {steps.map((step) => <article key={step.index}>
        <span className="decision-pipeline__index">0{step.index}</span>
        <div><small>{step.label}</small><strong>{step.title}</strong>
          <b>{step.primary}</b><p>{step.secondary}</p></div>
      </article>)}
    </div>
  </section>
}

export type TracePoint = {
  progress: number
  aiReceivers: number
  baselineReceivers: number
  aiDelay: number
  baselineDelay: number
}

// eslint-disable-next-line react-refresh/only-export-components
export function traceSeries(pairs: readonly ComparisonPair[]): TracePoint[] {
  if (!pairs.length) return []
  const first = pairs[0].ai.timestamp
  const last = pairs[pairs.length - 1].ai.timestamp
  const span = Math.max(0.001, last - first)
  const stride = Math.max(1, Math.ceil(pairs.length / 90))
  return pairs.filter((_, index) => index % stride === 0 || index === pairs.length - 1).map((pair) => ({
    progress: (pair.ai.timestamp - first) / span,
    aiReceivers: new Set(pair.ai.decision.selected_receivers).size,
    baselineReceivers: new Set(pair.baseline.decision.selected_receivers).size,
    aiDelay: pair.ai.metrics.avg_delay_ms,
    baselineDelay: pair.baseline.metrics.avg_delay_ms,
  }))
}

function points(values: TracePoint[], key: keyof Pick<TracePoint, 'aiReceivers' | 'baselineReceivers'>,
  width: number, height: number, maximum: number): string {
  return values.map((point) => `${(point.progress * width).toFixed(1)},${
    (height - Number(point[key]) / Math.max(1, maximum) * height).toFixed(1)}`).join(' ')
}

function LiveTrace({ pairs }: { pairs: readonly ComparisonPair[] }) {
  const series = useMemo(() => traceSeries(pairs), [pairs])
  const maximum = Math.max(1, ...series.flatMap((point) => [point.aiReceivers, point.baselineReceivers]))
  if (!series.length) return <p className="evidence-empty">等待本次真实仿真轨迹。</p>
  return <div className="live-trace">
    <div className="trace-legend"><span className="is-baseline">传统广播</span><span className="is-ai">AI选择性广播</span></div>
    <svg viewBox="0 0 720 112" role="img" aria-label="两种方法随仿真时间变化的通知车辆数曲线">
      {[0, 1, 2, 3, 4].map((line) => <line key={line} x1="0" x2="720" y1={line * 28} y2={line * 28} />)}
      <polyline className="trace-baseline" points={points(series, 'baselineReceivers', 720, 104, maximum)} />
      <polyline className="trace-ai" points={points(series, 'aiReceivers', 720, 104, maximum)} />
      <line className="trace-marker" x1="116" x2="116" y1="0" y2="108" />
      <text x="122" y="13">事故 / 决策触发</text>
    </svg>
    <p>曲线直接来自本次 WebSocket 同步帧；同一横坐标对应同一仿真时间戳。</p>
  </div>
}

const METHOD_LABELS: Record<string, string> = {
  ai: 'AI + PPO', broadcast: '全量广播', distance: '距离筛选', urgency: '紧急度调度',
  fixed_directional_corridor: '固定方向走廊',
}

const METRIC_ROWS = [
  { key: 'affected_vehicle_coverage', label: '受影响车辆覆盖率', percent: true, lowerBetter: false },
  { key: 'normalized_channel_cost', label: '归一化信道开销', percent: false, lowerBetter: true },
  { key: 'p95_latency_ms', label: 'P95 时延 / ms', percent: false, lowerBetter: true },
] as const

function metricText(metric: MetricEstimate, percent: boolean): string {
  return percent ? `${(metric.mean * 100).toFixed(1)}%` : metric.mean.toFixed(2)
}

function HeldOutResults({ results }: { results: DemoResultsSummary | null }) {
  if (!results?.ready) return <div className="evidence-empty">
    <strong>留出集统计尚未通过展示门禁</strong><p>{results?.reason ?? '正在读取规范化结果文件。'}</p>
  </div>
  const methods = Object.entries(results.methods)
  return <div className="heldout-results">
    <header><span>均值与 95% 置信区间</span><b>n={results.case_count ?? '—'} 个独立场景</b></header>
    {METRIC_ROWS.map((row) => {
      const available = methods.flatMap(([method, metrics]) => metrics[row.key]
        ? [{ method, metric: metrics[row.key] }] : [])
      const max = Math.max(...available.map(({ metric }) => metric.ci95[1]), 0.001)
      return <section key={row.key}>
        <h4>{row.label}<small>{row.lowerBetter ? '越低越好' : '越高越好'}</small></h4>
        <div>{available.map(({ method, metric }) => <span key={method} className={method === 'ai' ? 'is-ai' : ''}>
          <label>{METHOD_LABELS[method] ?? method}</label>
          <i style={{ width: `${Math.max(2, metric.mean / max * 100)}%` }} />
          <b>{metricText(metric, row.percent)}</b>
          <em>CI [{metricText({ ...metric, mean: metric.ci95[0] }, row.percent)}, {
            metricText({ ...metric, mean: metric.ci95[1] }, row.percent)}]</em>
        </span>)}</div>
      </section>
    })}
    <p>统计显著性采用配对 Wilcoxon 检验并进行 Holm 多重比较校正。</p>
  </div>
}

function relationText(relation: ReceiverRelation | undefined): string {
  if (!relation) return '未进入车辆—事件关系表'
  const outcomes: Record<string, string> = {
    selected: '位于策略风险走廊内，AI选择通知', ahead: '位于事故车前方，无追尾传播需求',
    outside_lane_scope: '不在动作选择的车道范围', outside_corridor: '位于后方但超出风险走廊',
    opposite_direction: '行驶方向相反，不属于本次传播关系',
  }
  return outcomes[relation.outcome] ?? relation.outcome
}

function VehicleXRay({ pair, vehicleId }: { pair: ComparisonPair | null; vehicleId: string | null }) {
  if (!pair || !vehicleId) return <p className="evidence-empty">点击任一画面中的车辆，查看两种方法对同一车辆的判定证据。</p>
  const vehicle = pair.ai.vehicles.find((item) => item.id === vehicleId)
  const relation = pair.ai.decision.receiver_relations?.find((item) => item.id === vehicleId)
  const aiSelected = pair.ai.decision.selected_receivers.includes(vehicleId)
  const baselineSelected = pair.baseline.decision.selected_receivers.includes(vehicleId)
  return <div className="vehicle-xray">
    <header><ScanSearch aria-hidden="true" /><strong>{vehicleId}</strong><span>同车 · 同帧 · 双策略判定</span></header>
    <div className="vehicle-xray__facts">
      <span><small>位置</small><b>{vehicle ? `${vehicle.x.toFixed(1)} m / ${vehicle.y.toFixed(1)} m` : '—'}</b></span>
      <span><small>纵向关系</small><b>{relation ? `${relation.longitudinal_m.toFixed(1)} m` : '—'}</b></span>
      <span><small>车道关系</small><b>{relation?.lane_relation ?? '—'}</b></span>
      <span><small>风险类别</small><b>{relation?.risk_class ?? '—'}</b></span>
    </div>
    <div className="vehicle-xray__verdicts">
      <article className={baselineSelected ? 'is-selected' : ''}><small>全量广播</small><strong>{baselineSelected ? '通知' : '不通知'}</strong><p>通信域内统一发送，不使用逐车风险关系。</p></article>
      <article className={aiSelected ? 'is-ai is-selected' : 'is-ai'}><small>AI + PPO</small><strong>{aiSelected ? '通知' : '不通知'}</strong><p>{relationText(relation)}</p></article>
    </div>
  </div>
}

function Provenance({ results }: { results: DemoResultsSummary | null }) {
  const provenance = results?.provenance
  if (!results?.ready || !provenance) return <p className="evidence-empty">结果门禁未通过时，来源信息与统计结论均不展示。</p>
  return <div className="evidence-provenance">
    <Database aria-hidden="true" /><span><small>实验协议</small><strong>{results.protocol} / schema v{results.metric_schema_version}</strong></span>
    <GitCommitHorizontal aria-hidden="true" /><span><small>代码提交</small><strong>{provenance.commit?.slice(0, 12) ?? '—'}{provenance.dirty ? ' · dirty' : ' · clean'}</strong></span>
    <ShieldCheck aria-hidden="true" /><span><small>资格门禁</small><strong>{results.acceptance?.passed ? '已通过' : '未通过'} · {results.result_rows ?? 0} 条结果</strong></span>
    <Network aria-hidden="true" /><span><small>行为审计</small><strong>前向误通知 {results.behavioral_gate?.forward_notifications ?? '—'} 次</strong></span>
    <p>模型 SHA-256：<code>{provenance.model_sha256 ?? '—'}</code></p>
    <p>范围：{results.scope ?? '未声明'}。结论仅适用于清单中声明的实验范围。</p>
  </div>
}

type EvidenceTab = 'trace' | 'heldout' | 'vehicle' | 'provenance'

export function EvidenceBand({ pair, pairs, results, elapsedMs, selectedVehicleId }: {
  pair: ComparisonPair | null
  pairs: readonly ComparisonPair[]
  results: DemoResultsSummary | null
  elapsedMs: number
  selectedVehicleId: string | null
}) {
  const [override, setOverride] = useState<boolean | null>(null)
  const [tab, setTab] = useState<EvidenceTab>('trace')
  useEffect(() => {
    if (elapsedMs < 30_000) setOverride(null)
  }, [elapsedMs])
  useEffect(() => {
    if (selectedVehicleId && override === true) setTab('vehicle')
  }, [override, selectedVehicleId])
  const expanded = override ?? elapsedMs >= 33_000
  const aiCount = new Set(pair?.ai.decision.selected_receivers ?? []).size
  const baselineCount = new Set(pair?.baseline.decision.selected_receivers ?? []).size
  const loadReduction = pair && pair.baseline.messages.length
    ? (1 - pair.ai.messages.length / pair.baseline.messages.length) * 100 : null
  const delayReduction = pair && pair.baseline.metrics.avg_delay_ms
    ? (1 - pair.ai.metrics.avg_delay_ms / pair.baseline.metrics.avg_delay_ms) * 100 : null
  const deliveryGain = pair
    ? (pair.ai.metrics.delivery_rate - pair.baseline.metrics.delivery_rate) * 100 : null
  return <section className={`evidence-band ${expanded ? 'evidence-band--expanded' : ''}`}
    aria-label="实验与决策证据带">
    <button type="button" className="evidence-band__handle" aria-expanded={expanded}
      onClick={() => setOverride(!expanded)}>
      <span><BarChart3 aria-hidden="true" />证据面板</span>
      <div>
        <b>{Math.max(0, baselineCount - aiCount)}<small>少通知车辆</small></b>
        <b>{loadReduction === null ? '—' : `${loadReduction.toFixed(1)}%`}<small>负载降低</small></b>
        <b>{delayReduction === null ? '—' : `${delayReduction.toFixed(1)}%`}<small>时延改善</small></b>
        <b>{deliveryGain === null ? '—' : `${deliveryGain >= 0 ? '+' : ''}${deliveryGain.toFixed(1)}pp`}<small>送达率变化</small></b>
      </div>
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
    </button>
    {expanded && <div className="evidence-band__body">
      <nav aria-label="证据类别">
        {([
          ['trace', '本次轨迹', Route], ['heldout', '留出集结果', BarChart3],
          ['vehicle', '车辆证据', ScanSearch], ['provenance', '来源审计', Database],
        ] as const).map(([value, label, Icon]) => <button type="button" key={value}
          className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>
          <Icon aria-hidden="true" />{label}</button>)}
      </nav>
      <div className="evidence-band__content">
        {tab === 'trace' && <LiveTrace pairs={pairs} />}
        {tab === 'heldout' && <HeldOutResults results={results} />}
        {tab === 'vehicle' && <VehicleXRay pair={pair} vehicleId={selectedVehicleId} />}
        {tab === 'provenance' && <Provenance results={results} />}
      </div>
    </div>}
  </section>
}
