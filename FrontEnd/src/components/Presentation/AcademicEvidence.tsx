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
      index: 1, label: 'OBSERVATION', title: 'Vehicle–Incident State',
      primary: `${update.vehicles.length} vehicles · Severity ${(event?.severity ?? 0).toFixed(2)}`,
      secondary: 'Position, speed, lane, and incident level form the structured observation',
    },
    {
      index: 2, label: 'ENCODING', title: 'Transformer Relation Encoding',
      primary: topAttention
        ? `Highest relation weight ${topAttention.vehicle_id} · ${(topAttention.weight * 100).toFixed(1)}%`
        : 'Contextual vehicle–incident relation vector',
      secondary: 'z = Transformer(Xvehicle, Xevent); weights are interpretive cues, not causal claims',
    },
    {
      index: 3, label: 'POLICY', title: 'Structured PPO Action',
      primary: `${update.decision.corridor_radius_m?.toFixed(0) ?? '—'} m · ${
        update.decision.corridor_lane_scope === 'same_and_adjacent' ? 'same + adjacent lanes' : 'same lane only'}`,
      secondary: `a ~ πθ(a | z) · ${update.decision.priority.toUpperCase()} priority · ${(totalBandwidth(update) * 100).toFixed(0)}% bandwidth`,
    },
    {
      index: 4, label: 'OUTCOME', title: 'Receiver Set and Network Outcome',
      primary: `${selected.size} selected · ${delivered}/${update.messages.length} messages delivered`,
      secondary: `Average latency ${update.metrics.avg_delay_ms.toFixed(1)} ms · Load ${update.metrics.comm_overhead.toFixed(2)}`,
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
    aria-label="Four-step AI decision chain">
    <header><span>Auditable AI Decision Chain</span><code>z → πθ → a</code></header>
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
  if (!series.length) return <p className="evidence-empty">Waiting for the current production simulation trace.</p>
  return <div className="live-trace">
    <div className="trace-legend"><span className="is-baseline">Conventional Baseline</span><span className="is-ai">AI Selective Broadcast</span></div>
    <svg viewBox="0 0 720 112" role="img" aria-label="Notified-vehicle counts for both methods over simulation time">
      {[0, 1, 2, 3, 4].map((line) => <line key={line} x1="0" x2="720" y1={line * 28} y2={line * 28} />)}
      <polyline className="trace-baseline" points={points(series, 'baselineReceivers', 720, 104, maximum)} />
      <polyline className="trace-ai" points={points(series, 'aiReceivers', 720, 104, maximum)} />
      <line className="trace-marker" x1="116" x2="116" y1="0" y2="108" />
      <text x="122" y="13">Incident / decision trigger</text>
    </svg>
    <p>The curves come directly from synchronized WebSocket frames; each horizontal position represents the same simulation timestamp.</p>
  </div>
}

const METHOD_LABELS: Record<string, string> = {
  ai: 'AI + PPO', broadcast: 'Broadcast', distance: 'Fixed Radius', urgency: 'Urgency Scheduling',
  fixed_directional_corridor: 'Fixed Directional Corridor',
}

const METRIC_ROWS = [
  { key: 'affected_vehicle_coverage', label: 'Affected-Vehicle Coverage', percent: true, lowerBetter: false },
  { key: 'normalized_channel_cost', label: 'Normalized Channel Cost', percent: false, lowerBetter: true },
  { key: 'p95_latency_ms', label: 'P95 Latency / ms', percent: false, lowerBetter: true },
] as const

function metricText(metric: MetricEstimate, percent: boolean): string {
  return percent ? `${(metric.mean * 100).toFixed(1)}%` : metric.mean.toFixed(2)
}

function HeldOutResults({ results }: { results: DemoResultsSummary | null }) {
  if (!results?.ready) return <div className="evidence-empty">
    <strong>Held-out statistics have not passed the presentation gate</strong><p>{results?.reason ?? 'Loading the normalized result artifact.'}</p>
  </div>
  const methods = Object.entries(results.methods)
  return <div className="heldout-results">
    <header><span>Mean and 95% confidence interval</span><b>n={results.case_count ?? '—'} independent scenarios</b></header>
    {METRIC_ROWS.map((row) => {
      const available = methods.flatMap(([method, metrics]) => metrics[row.key]
        ? [{ method, metric: metrics[row.key] }] : [])
      const max = Math.max(...available.map(({ metric }) => metric.ci95[1]), 0.001)
      return <section key={row.key}>
        <h4>{row.label}<small>{row.lowerBetter ? 'Lower is better' : 'Higher is better'}</small></h4>
        <div>{available.map(({ method, metric }) => <span key={method} className={method === 'ai' ? 'is-ai' : ''}>
          <label>{METHOD_LABELS[method] ?? method}</label>
          <i style={{ width: `${Math.max(2, metric.mean / max * 100)}%` }} />
          <b>{metricText(metric, row.percent)}</b>
          <em>CI [{metricText({ ...metric, mean: metric.ci95[0] }, row.percent)}, {
            metricText({ ...metric, mean: metric.ci95[1] }, row.percent)}]</em>
        </span>)}</div>
      </section>
    })}
    <p>Statistical significance uses paired Wilcoxon tests with Holm correction for multiple comparisons.</p>
  </div>
}

function relationText(relation: ReceiverRelation | undefined): string {
  if (!relation) return 'Not present in the vehicle–incident relation table'
  const outcomes: Record<string, string> = {
    selected: 'Inside the policy risk corridor; AI selected this receiver', ahead: 'Ahead of the incident vehicle; no rear-end propagation need',
    outside_lane_scope: 'Outside the action-selected lane scope', outside_corridor: 'Behind the incident but outside the risk corridor',
    opposite_direction: 'Travelling in the opposite direction; unrelated to this propagation path',
  }
  return outcomes[relation.outcome] ?? relation.outcome
}

function VehicleXRay({ pair, vehicleId }: { pair: ComparisonPair | null; vehicleId: string | null }) {
  if (!pair || !vehicleId) return <p className="evidence-empty">Select a vehicle in either view to inspect both methods' evidence for the same vehicle.</p>
  const vehicle = pair.ai.vehicles.find((item) => item.id === vehicleId)
  const relation = pair.ai.decision.receiver_relations?.find((item) => item.id === vehicleId)
  const aiSelected = pair.ai.decision.selected_receivers.includes(vehicleId)
  const baselineSelected = pair.baseline.decision.selected_receivers.includes(vehicleId)
  return <div className="vehicle-xray">
    <header><ScanSearch aria-hidden="true" /><strong>{vehicleId}</strong><span>Same vehicle · Same frame · Two strategies</span></header>
    <div className="vehicle-xray__facts">
      <span><small>Position</small><b>{vehicle ? `${vehicle.x.toFixed(1)} m / ${vehicle.y.toFixed(1)} m` : '—'}</b></span>
      <span><small>Longitudinal Relation</small><b>{relation ? `${relation.longitudinal_m.toFixed(1)} m` : '—'}</b></span>
      <span><small>Lane Relation</small><b>{relation?.lane_relation ?? '—'}</b></span>
      <span><small>Risk Class</small><b>{relation?.risk_class ?? '—'}</b></span>
    </div>
    <div className="vehicle-xray__verdicts">
      <article className={baselineSelected ? 'is-selected' : ''}><small>Broadcast</small><strong>{baselineSelected ? 'Notify' : 'Do Not Notify'}</strong><p>Sends uniformly within the communication domain without per-vehicle risk relations.</p></article>
      <article className={aiSelected ? 'is-ai is-selected' : 'is-ai'}><small>AI + PPO</small><strong>{aiSelected ? 'Notify' : 'Do Not Notify'}</strong><p>{relationText(relation)}</p></article>
    </div>
  </div>
}

function Provenance({ results }: { results: DemoResultsSummary | null }) {
  const provenance = results?.provenance
  if (!results?.ready || !provenance) return <p className="evidence-empty">Provenance and statistical conclusions remain hidden until the result gate passes.</p>
  return <div className="evidence-provenance">
    <Database aria-hidden="true" /><span><small>Experiment Protocol</small><strong>{results.protocol} / schema v{results.metric_schema_version}</strong></span>
    <GitCommitHorizontal aria-hidden="true" /><span><small>Code Commit</small><strong>{provenance.commit?.slice(0, 12) ?? '—'}{provenance.dirty ? ' · dirty' : ' · clean'}</strong></span>
    <ShieldCheck aria-hidden="true" /><span><small>Eligibility Gate</small><strong>{results.acceptance?.passed ? 'Passed' : 'Failed'} · {results.result_rows ?? 0} results</strong></span>
    <Network aria-hidden="true" /><span><small>Behavior Audit</small><strong>{results.behavioral_gate?.forward_notifications ?? '—'} forward notifications</strong></span>
    <p>Model SHA-256: <code>{provenance.model_sha256 ?? '—'}</code></p>
    <p>Scope: {results.scope ?? 'Not declared'}. Conclusions apply only to the experiment scope declared in the manifest.</p>
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
    aria-label="Experiment and decision evidence band">
    <button type="button" className="evidence-band__handle" aria-expanded={expanded}
      onClick={() => setOverride(!expanded)}>
      <span><BarChart3 aria-hidden="true" />Evidence Panel</span>
      <div>
        <b>{Math.max(0, baselineCount - aiCount)}<small>Fewer Vehicles</small></b>
        <b>{loadReduction === null ? '—' : `${loadReduction.toFixed(1)}%`}<small>Load Reduction</small></b>
        <b>{delayReduction === null ? '—' : `${delayReduction.toFixed(1)}%`}<small>Latency Improvement</small></b>
        <b>{deliveryGain === null ? '—' : `${deliveryGain >= 0 ? '+' : ''}${deliveryGain.toFixed(1)}pp`}<small>Delivery Change</small></b>
      </div>
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
    </button>
    {expanded && <div className="evidence-band__body">
      <nav aria-label="Evidence category">
        {([
          ['trace', 'Current Trace', Route], ['heldout', 'Held-Out Results', BarChart3],
          ['vehicle', 'Vehicle Evidence', ScanSearch], ['provenance', 'Provenance Audit', Database],
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
