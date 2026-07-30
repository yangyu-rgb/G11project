import { Activity, Gauge, Network, RadioTower } from 'lucide-react'

import type { LiveComparisonTelemetry, MethodTelemetry, SpeedTracePoint } from '../../types/liveTelemetry'
import type { ComparisonBaseline } from '../../types/simulation'
import { baselineDefinition } from './presentationMethods'

function sparklinePoints(values: readonly SpeedTracePoint[]): string {
  if (!values.length) return ''
  const minTime = values[0].timestamp
  const maxTime = values[values.length - 1].timestamp
  const span = Math.max(0.001, maxTime - minTime)
  const maxSpeed = Math.max(100, ...values.map((point) => point.speedKmh))
  return values.map((point) => `${((point.timestamp - minTime) / span * 168).toFixed(1)},${
    (50 - point.speedKmh / maxSpeed * 46).toFixed(1)}`).join(' ')
}

function MethodReadout({ data, label, tone }: {
  data: MethodTelemetry
  label: string
  tone: 'baseline' | 'ai'
}) {
  const priority = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' }[data.priority] ?? data.priority.toUpperCase()
  const bandwidthPercent = Math.round(data.bandwidthFraction * 100)
  return <section className={`telemetry-method telemetry-method--${tone}`}
    aria-label={`${label} current-frame network metrics`}>
    <header><span>{tone === 'ai' ? <Network aria-hidden="true" /> : <RadioTower aria-hidden="true" />}
      <strong>{label}</strong></span><time>LIVE REPLAY</time></header>
    <div><span><small>Notified Vehicles</small><b>{data.selectedCount}</b></span>
      <span><small>Total Transmissions</small><b>{data.sentCount}</b></span>
      <span><small>Average Latency</small><b>{data.avgDelayMs.toFixed(1)}<em>ms</em></b></span>
      <span><small>Send/Success Ratio</small><b>{data.commOverhead.toFixed(2)}</b></span></div>
    <section className="telemetry-resource"
      aria-label={`${label} current resource decision: ${priority} priority and ${bandwidthPercent}% total bandwidth`}>
      <span><small>Current Resource Decision</small><b>{priority} priority · {bandwidthPercent}% total bandwidth</b></span>
      <i aria-hidden="true"><em style={{ transform: `scaleX(${data.bandwidthFraction})` }} /></i>
    </section>
    <footer><span className="is-success">Delivered {data.successCount}</span>
      <span className={data.timeoutCount ? 'is-timeout' : ''}>Timeouts {data.timeoutCount}</span>
      <span>Delivery {(data.deliveryRate * 100).toFixed(1)}%</span></footer>
  </section>
}

function deltaText(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

export function LiveTelemetryHud({ telemetry, baseline }: {
  telemetry: LiveComparisonTelemetry
  baseline: ComparisonBaseline
}) {
  const method = baselineDefinition(baseline)
  const funnel = telemetry.funnel
  const laneScope = telemetry.action.laneScope === 'same_and_adjacent' ? 'Same + adjacent lanes' : 'Same lane only'
  const resourceNote = baseline === 'urgency'
    ? 'Same 300 m receiver set · Severity-based resources'
    : baseline === 'distance'
      ? '300 m receiver set · Fixed resources'
      : 'Full communication-domain receiver set · Fixed resources'
  return <div className="live-telemetry-hud" aria-label="Live telemetry for the current replay frame">
    <section className="telemetry-process" aria-label="Incident dynamics and AI filtering process">
      <div className="telemetry-speed">
        <header><Activity aria-hidden="true" /><span><small>Incident Vehicle Speed</small>
          <strong>{telemetry.accidentSpeedKmh.toFixed(0)} <em>km/h</em></strong></span>
          <b>-{telemetry.decelerationMps2.toFixed(1)} m/s²</b></header>
        <svg viewBox="0 0 168 54" role="img" aria-label="Incident-vehicle speed over the current replay">
          <line x1="0" x2="168" y1="50" y2="50" />
          <polyline points={sparklinePoints(telemetry.speedTrace)} />
        </svg>
      </div>
      <div className="telemetry-funnel">
        <p><small>AI Receiver-Selection Funnel</small><time>Decision frame t={telemetry.simulationTimestamp.toFixed(1)} s · Replay {(telemetry.replayProgress * 100).toFixed(0)}%</time></p>
        <div>
          <span><b>{funnel.evaluated}</b><small>Evaluated</small></span><i />
          <span><b>{funnel.behindSameDirection}</b><small>Behind, Same Direction</small></span><i />
          <span><b>{funnel.laneRelevant}</b><small>Lane Relevant</small></span><i />
          <span className="is-selected"><b>{funnel.selected}</b><small>Final Receivers</small></span>
        </div>
        <footer><span><Gauge aria-hidden="true" />PPO Action</span>
          <b>{telemetry.action.corridorRadiusM?.toFixed(0) ?? '—'} m</b>
          <b>{laneScope}</b><b>{telemetry.action.priority.toUpperCase()}</b>
          <b>{(telemetry.action.bandwidthFraction * 100).toFixed(0)}% bandwidth</b></footer>
      </div>
    </section>

    <MethodReadout data={telemetry.baseline} label={method.label} tone="baseline" />
    <MethodReadout data={telemetry.ai} label="Transformer + PPO" tone="ai" />
    <section className="telemetry-delta" aria-label="Current-frame AI change relative to the selected baseline">
      <span><b>{telemetry.delta.fewerVehicles}</b><small>Fewer Vehicles</small></span>
      <span><b>{deltaText(telemetry.delta.loadReductionPercent)}</b><small>Load Improvement</small></span>
      <span><b>{deltaText(telemetry.delta.delayReductionPercent)}</b><small>Latency Improvement</small></span>
      <span><b>{telemetry.delta.deliveryGainPoints >= 0 ? '+' : ''}{telemetry.delta.deliveryGainPoints.toFixed(1)}pp</b><small>Delivery Change</small></span>
    </section>
    <p className="telemetry-resource-note">Baseline definition: {resourceNote}. Resource bars come from the current synchronized decision frame.</p>
  </div>
}
