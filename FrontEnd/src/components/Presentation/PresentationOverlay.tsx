import {
  AlertTriangle, CheckCircle2, Clapperboard, Cpu, FlaskConical, Gauge, Pause, Play,
  RadioTower, RotateCcw, Ruler, Satellite, ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import {
  PRESENTATION_DENSITIES,
  type PresentationDensity,
} from '../SceneEditor/PresetScenes'
import type {
  ComparisonBaseline, ComparisonPair, SimulationVehicle,
} from '../../types/simulation'
import type { DemoResultsSummary } from '../../types/demoResults'
import type { LiveComparisonTelemetry } from '../../types/liveTelemetry'
import type { PresentationMode, PresentationPhase, PresentationSource } from '../../hooks/usePresentationDemo'
import { evidenceForVehicle } from '../../types/research'
import { nearestHighwayLaneIndex } from '../ThreeD/sceneCoordinates'
import {
  PRESENTATION_ATMOSPHERE_ORDER,
  PRESENTATION_ATMOSPHERES,
  PRESENTATION_ENVIRONMENT_ORDER,
  PRESENTATION_ENVIRONMENTS,
  RENDER_PREFERENCES,
  presentationEnvironmentDefinition,
  type PresentationAtmosphere,
  type PresentationEnvironment,
  type RenderPreference,
} from '../ThreeD/environmentPresets'
import {
  comparisonMetrics,
  conclusionFor,
  PRESENTATION_DURATION_MS,
  presentationCueAt,
  STAGE_LABELS,
  type PresentationStage,
} from './presentationTimeline'
import { BASELINE_DEFINITIONS, baselineDefinition } from './presentationMethods'
import { LiveTelemetryHud } from './LiveTelemetryHud'

type SelectionPanelProps = {
  vehicles: SimulationVehicle[]
  selectedVehicleId: string | null
  recommendedVehicleId: string
  preparing: boolean
  density: PresentationDensity
  environmentPreset: PresentationEnvironment
  atmosphere: PresentationAtmosphere
  renderPreference: RenderPreference
  modelEligible: boolean
  modelReason: string | null
  modelHash: string | null
  notice: string | null
  baseline: ComparisonBaseline
  onDensityChange: (density: PresentationDensity) => void
  onEnvironmentChange: (environment: PresentationEnvironment) => void
  onAtmosphereChange: (atmosphere: PresentationAtmosphere) => void
  onRenderPreferenceChange: (preference: RenderPreference) => void
  onVehicleSelect: (vehicleId: string) => void
  onBaselineChange: (baseline: ComparisonBaseline) => void
  onStart: () => void
}

const HIGHWAY_LANE_LABELS = ['Outer Lane', 'Middle Lane', 'Inner Lane'] as const

function vehicleOptionLabel(vehicle: SimulationVehicle): string {
  const lane = HIGHWAY_LANE_LABELS[nearestHighwayLaneIndex(vehicle.y)]
  return `${vehicle.id} · ${lane} · ${vehicle.x.toFixed(0)} m`
}

export function SelectionPanel({ vehicles, selectedVehicleId, recommendedVehicleId, preparing,
  density, environmentPreset, atmosphere, renderPreference, modelEligible, modelReason, modelHash,
  notice, baseline, onDensityChange, onEnvironmentChange, onAtmosphereChange,
  onRenderPreferenceChange, onVehicleSelect, onBaselineChange, onStart }: SelectionPanelProps) {
  const selected = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  const orderedVehicles = useMemo(
    () => [...vehicles].sort((left, right) => right.x - left.x || left.id.localeCompare(right.id)),
    [vehicles],
  )
  const selectedLane = selected ? HIGHWAY_LANE_LABELS[nearestHighwayLaneIndex(selected.y)] : null
  const selectedSpeed = selected ? Math.hypot(selected.vx, selected.vy) * 3.6 : null
  const selectedPosition = selected && vehicles.length > 1
    ? Math.round(100 * vehicles.filter((vehicle) => vehicle.x <= selected.x).length / vehicles.length)
    : null
  const recommended = selected?.id === recommendedVehicleId
  const xs = vehicles.map((vehicle) => vehicle.x)
  const minX = Math.min(...xs)
  const spanX = Math.max(1, Math.max(...xs) - minX)
  const lanes = [...new Set(vehicles.map((vehicle) => vehicle.y))].sort((a, b) => a - b)
  const selectedMethod = baselineDefinition(baseline)
  return <section className="demo-setup-stage" aria-labelledby="selection-heading">
    <header className="demo-setup-heading">
      <div><p className="hud-kicker">PRESENTATION CONFIGURATION</p>
        <h2 id="selection-heading">Build a Reproducible Synchronized Comparison</h2>
        <p>Lock the scene, incident source, and comparison method before running production PPO and a deterministic baseline with the same random seed.</p></div>
      <span><b>38 s</b><small>Four-stage demo</small></span>
    </header>

    <div className="demo-setup-grid">
      <section className="setup-section setup-section--scenario">
        <header><span>01</span><div><strong>Incident Scenario</strong><small>Control traffic scale and incident position</small></div></header>
        <fieldset className="environment-selector" disabled={preparing}
          aria-describedby="environment-selector-help">
          <legend>Visual Road Environment</legend>
          {PRESENTATION_ENVIRONMENT_ORDER.map((value) => {
            const definition = PRESENTATION_ENVIRONMENTS[value]
            return <button type="button" key={value}
              className={environmentPreset === value ? 'is-active' : ''}
              aria-pressed={environmentPreset === value}
              onClick={() => onEnvironmentChange(value)}>
              <i className={`environment-thumb environment-thumb--${value}`} aria-hidden="true"><b /><em /></i>
              <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
            </button>
          })}
        </fieldset>
        <p className="environment-selector-help" id="environment-selector-help">
          Only 3D materials, lighting, and roadside context change. Vehicle trajectories, incident parameters, network inputs, and PPO decisions remain identical.
        </p>
        <div className="visual-configuration-row">
          <label>Atmosphere<select value={atmosphere} disabled={preparing}
            onChange={(event) => onAtmosphereChange(event.target.value as PresentationAtmosphere)}>
            {PRESENTATION_ATMOSPHERE_ORDER.map((value) => <option key={value} value={value}>
              {PRESENTATION_ATMOSPHERES[value].label}
            </option>)}
          </select><small>{PRESENTATION_ATMOSPHERES[atmosphere].description}</small></label>
          <label>Visual Quality<select value={renderPreference} disabled={preparing}
            onChange={(event) => onRenderPreferenceChange(event.target.value as RenderPreference)}>
            {(Object.keys(RENDER_PREFERENCES) as RenderPreference[]).map((value) => <option
              key={value} value={value}>{RENDER_PREFERENCES[value].label}</option>)}
          </select><small>{RENDER_PREFERENCES[renderPreference].description}</small></label>
        </div>
        <fieldset className="density-selector" disabled={preparing}>
          <legend>Traffic Density</legend>
          {(Object.entries(PRESENTATION_DENSITIES) as Array<[
            PresentationDensity, (typeof PRESENTATION_DENSITIES)[PresentationDensity]
          ]>).map(([value, setting]) => <button type="button" key={value}
            className={density === value ? 'is-active' : ''}
            onClick={() => onDensityChange(value)}>
            <strong>{setting.label}</strong><small>{setting.description}</small>
          </button>)}
        </fieldset>
        <div className="setup-road-map" aria-label="Three-lane vehicle-position preview">
          {lanes.map((lane, laneIndex) => <div key={lane}>
            <span>{HIGHWAY_LANE_LABELS[laneIndex] ?? `Lane ${laneIndex + 1}`}</span>
            <i />
          </div>)}
          {vehicles.map((vehicle) => <button type="button" key={vehicle.id}
            className={vehicle.id === selectedVehicleId ? 'is-selected' : ''}
            aria-label={`Select ${vehicleOptionLabel(vehicle)} as the incident vehicle`}
            aria-pressed={vehicle.id === selectedVehicleId} disabled={preparing}
            title={vehicleOptionLabel(vehicle)} onClick={() => onVehicleSelect(vehicle.id)} style={{
              '--vehicle-x': `${3 + (vehicle.x - minX) / spanX * 94}%`,
              '--vehicle-lane': lanes.indexOf(vehicle.y),
            } as React.CSSProperties}><i aria-hidden="true" /></button>)}
        </div>
        <label htmlFor="incident-vehicle-select">Select Incident Vehicle Precisely</label>
        <select id="incident-vehicle-select" value={selectedVehicleId ?? ''} disabled={preparing}
          onChange={(event) => onVehicleSelect(event.target.value)}>
          {!selectedVehicleId && <option value="" disabled>Select a vehicle</option>}
          {orderedVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>
            {vehicleOptionLabel(vehicle)}
          </option>)}
        </select>
        <div className="selected-vehicle-card" aria-live="polite">
          {selected ? <><span>Current Incident Vehicle <em>{recommended ? 'Recommended position' : 'Custom position'}</em></span>
            <strong>{selected.id}</strong><small>{selectedLane} · Approximately {selectedPosition}% along the segment · Initial speed {selectedSpeed?.toFixed(0)} km/h</small></>
            : <span>Select an incident vehicle</span>}
        </div>
      </section>

      <section className="setup-section setup-section--methods">
        <header><span>02</span><div><strong>Algorithm Pairing</strong><small>AI is locked to the accepted model; select a deterministic baseline</small></div></header>
        <article className={`locked-model-card ${modelEligible ? 'is-eligible' : ''}`}>
          <Cpu aria-hidden="true" /><div><small>LEARNED POLICY · LOCKED</small>
            <strong>Transformer + PPO V2</strong><p>Structured directional risk-corridor action · Production presentation model</p>
            <code>{modelHash ? `SHA ${modelHash.slice(0, 12)}…` : 'Verifying model manifest'}</code></div>
          <span>{modelEligible ? <><CheckCircle2 />Eligible</> : <><AlertTriangle />Unavailable</>}</span>
        </article>
        <fieldset className="baseline-selector" disabled={preparing}>
          <legend>Select a Deterministic Baseline</legend>
          {BASELINE_DEFINITIONS.map((method) => {
            const Icon = method.id === 'broadcast' ? RadioTower : method.id === 'distance' ? Ruler : Gauge
            return <button type="button" key={method.id}
              className={baseline === method.id ? 'is-active' : ''}
              onClick={() => onBaselineChange(method.id)}>
              <Icon aria-hidden="true" /><span><strong>{method.label}</strong><small>{method.description}</small>
                <code>{method.rule}</code></span>{baseline === method.id && <CheckCircle2 aria-hidden="true" />}
            </button>
          })}
        </fieldset>
        {!modelEligible && <div className="model-gate-warning" role="status">
          <AlertTriangle aria-hidden="true" /><span><strong>AI demo unavailable</strong>{modelReason ?? 'Verifying production-model eligibility'}</span>
        </div>}
      </section>
    </div>

    <footer className="demo-setup-footer">
      <div><span><small>Scene</small><b>{presentationEnvironmentDefinition(environmentPreset).shortLabel} · {PRESENTATION_ATMOSPHERES[atmosphere].label}</b></span>
        <span><small>Braking</small><b>96 → 18 km/h</b></span>
        <span><small>Incident Source</small><b>{selected?.id ?? 'Not selected'}</b></span>
        <span><small>Synchronized Pair</small><b>{selectedMethod.label} vs AI</b></span></div>
      {notice && <p className="selection-notice" role="status">{notice}</p>}
      <button type="button" className="primary-action" disabled={!selected || preparing || !modelEligible} onClick={onStart}>
        <Play aria-hidden="true" />{preparing ? 'Computing production comparison…' : 'Confirm and Generate Demo'}
      </button>
    </footer>
  </section>
}

function AccidentSpeed({ vehicleId, channel }: { vehicleId: string; channel: AnimationChannel }) {
  const { animation } = useAnimationRuntime()
  const [speed, setSpeed] = useState(96)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const vehicle = animation.getVehicle(channel, vehicleId)
      if (vehicle) setSpeed(Math.hypot(vehicle.vx, vehicle.vy) * 3.6)
    }, 100)
    return () => window.clearInterval(timer)
  }, [animation, channel, vehicleId])
  return <strong className="accident-speed">{speed.toFixed(0)} <small>km/h</small></strong>
}

const DESCRIPTIONS: Record<PresentationStage, string> = {
  normal: 'Vehicles travel normally on the three-lane highway.',
  accident: 'The target vehicle brakes sharply and the V2X system immediately generates a safety alert.',
  comparison: 'Both algorithms run on the exact same incident state and timestamp.',
  summary: 'Communication outcomes for the same incident and timestamp.',
}

type DemoHudProps = {
  phase: PresentationPhase
  source: PresentationSource
  stage: PresentationStage
  elapsedMs: number
  evidence: ComparisonPair | null
  accidentVehicleId: string
  notice: string | null
  mode: PresentationMode
  inspectedVehicleId: string | null
  results: DemoResultsSummary | null
  comparisonMode: boolean
  telemetry: LiveComparisonTelemetry | null
  baseline: ComparisonBaseline
  environmentPreset: PresentationEnvironment
  atmosphere: PresentationAtmosphere
  onTogglePause: () => void
  onReplay: () => void
  onAutoplay: () => void
  onSeek: (elapsedMs: number) => void
  onReset: () => void
  onOpenValidation: () => void
}

export function DemoHud({ phase, source, stage, elapsedMs, evidence, accidentVehicleId, notice,
  mode, inspectedVehicleId, results, comparisonMode, telemetry, baseline, environmentPreset, atmosphere,
  onTogglePause, onReplay, onAutoplay, onSeek, onReset, onOpenValidation }: DemoHudProps) {
  const cue = presentationCueAt(elapsedMs)
  const channel: AnimationChannel = 'comparison-ai'
  const complete = phase === 'complete'
  const paused = phase === 'paused'
  const exploring = phase === 'exploring'
  const environment = presentationEnvironmentDefinition(environmentPreset)
  const bookmarks: Array<{ stage: PresentationStage; elapsedMs: number }> = [
    { stage: 'normal', elapsedMs: 0 }, { stage: 'accident', elapsedMs: 6_400 },
    { stage: 'comparison', elapsedMs: 17_000 }, { stage: 'summary', elapsedMs: 35_600 },
  ]
  return (
    <div className="presentation-hud">
      <div className="stage-strip" aria-label="Presentation progress">
        {bookmarks.map(({ stage: value, elapsedMs: bookmarkMs }, index) => {
          const activeIndex = (Object.keys(STAGE_LABELS) as PresentationStage[]).indexOf(stage)
          return <button type="button" key={value} onClick={() => onSeek(bookmarkMs)}
            className={`stage-step ${value === stage ? 'stage-step--active' : ''} ${index < activeIndex ? 'stage-step--complete' : ''}`}>
            <span>{index + 1}</span><b>{STAGE_LABELS[value]}</b>
          </button>
        })}
        <div className="timeline-progress" style={{ '--progress': `${Math.min(100, elapsedMs / PRESENTATION_DURATION_MS * 100)}%` } as React.CSSProperties} />
      </div>

      {source === 'rule' && <div className="degraded-badge" role="status">
        <AlertTriangle aria-hidden="true" />Rule-based preview · Not PPO output
      </div>}
      {notice && elapsedMs < 5_000
        && <p className="presentation-notice" aria-live="polite">{notice}</p>}

      {stage === 'comparison' && telemetry && <div className="evidence-time-badge">
        {environment.shortLabel} · {PRESENTATION_ATMOSPHERES[atmosphere].label} · Same production decision frame · Dual synchronized replay · 10 Hz cumulative telemetry
      </div>}

      {!comparisonMode && stage !== 'summary' && <section className={`narrative-card narrative-card--${stage}`}>
        <p className="hud-kicker">INCIDENT SCENARIO · {environment.label}</p>
        <h2>{STAGE_LABELS[stage]}</h2>
        <p>{DESCRIPTIONS[stage]}</p>
        {stage === 'accident' && <div className="accident-readout">
          <AlertTriangle aria-hidden="true" />
          <span>Incident Detected<small>{accidentVehicleId}</small></span>
          <AccidentSpeed vehicleId={accidentVehicleId} channel={channel} />
        </div>}
      </section>}

      {stage === 'comparison' && telemetry && <LiveTelemetryHud telemetry={telemetry} baseline={baseline} />}
      {stage === 'comparison' && !telemetry && <div className="telemetry-loading" role="status">Synchronizing current-frame telemetry…</div>}

      {stage === 'summary' && <FinalComparison pair={evidence} source={source} results={results}
        baseline={baseline} visibleMetricCount={cue.summaryMetricCount} showTagline={cue.showSummaryTagline}
        environmentLabel={environment.label} onOpenValidation={onOpenValidation} />}

      {exploring && stage === 'comparison' && inspectedVehicleId
        && inspectedVehicleId !== accidentVehicleId && evidence && <VehicleEvidenceCard
        pair={evidence} vehicleId={inspectedVehicleId} accidentVehicleId={accidentVehicleId} />}

      <div className="playback-controls" aria-label="Presentation playback controls">
        {!complete && <button type="button" onClick={onTogglePause}>
          {paused || exploring ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused || exploring ? 'Play' : 'Pause'}
        </button>}
        <button type="button" className={mode === 'autoplay' ? 'is-active' : ''} onClick={onAutoplay}>
          <Clapperboard aria-hidden="true" />Presentation Autoplay
        </button>
        <button type="button" onClick={onReplay}><RotateCcw aria-hidden="true" />Replay</button>
        <button type="button" onClick={onReset}>Reconfigure</button>
        <input type="range" aria-label="Presentation timeline" min="0" max={PRESENTATION_DURATION_MS}
          step="100" value={elapsedMs} onChange={(event) => onSeek(Number(event.target.value))} />
        <time>{Math.min(38, elapsedMs / 1000).toFixed(1)} / 38.0 s</time>
      </div>
    </div>
  )
}

function VehicleEvidenceCard({ pair, vehicleId, accidentVehicleId }: {
  pair: ComparisonPair; vehicleId: string; accidentVehicleId: string
}) {
  const [question, setQuestion] = useState<'why' | 'baseline' | 'stress'>('why')
  const ai = evidenceForVehicle(pair.ai, vehicleId)
  const baseline = evidenceForVehicle(pair.baseline, vehicleId)
  const method = baselineDefinition((pair.baseline.method ?? 'broadcast') as ComparisonBaseline)
  const relation = pair.ai.decision.receiver_relations?.find((item) => item.id === vehicleId)
  if (vehicleId === accidentVehicleId) return <aside className="vehicle-question-card" aria-label="Vehicle decision inquiry">
    <p className="hud-kicker">VEHICLE DECISION INQUIRY</p>
    <div className="vehicle-question-heading"><strong>{vehicleId}</strong><span className="is-sender">Incident Sender</span></div>
    <p>This vehicle sends the incident alert and is not part of the receiver-selection set. Select another vehicle to inspect why AI notified or ignored it.</p>
    <small>Try a same-lane follower or a distant vehicle notified by the baseline but ignored by AI.</small>
  </aside>
  const answer = question === 'baseline'
    ? baseline.selected
      ? `${method.label} sent a message to ${vehicleId}; compare it against the AI relation decision for this vehicle.`
      : `The selected baseline did not send a message to ${vehicleId} at this timestamp.`
    : question === 'stress'
      ? 'Low-bandwidth outcomes require a live network-stress run in the Validation Lab; this panel does not fabricate estimates.'
      : ai.selected
        ? `${vehicleId} entered the candidate set and was selected by the policy. Recorded reason: ${ai.reason}.`
        : ai.candidate
          ? `${vehicleId} is within the candidate scope but did not enter the final receiver set. Candidate scope is not the final action.`
          : relation?.outcome === 'ahead'
            ? `${vehicleId} is ahead of the incident vehicle and outside the rear-end risk direction, so AI did not notify it.`
            : relation?.outcome === 'outside_lane_scope'
              ? `${vehicleId} is outside the same/adjacent lane scope selected by the policy and remains de-emphasized.`
              : relation?.outcome === 'outside_corridor'
                ? `${vehicleId} is behind the incident vehicle but outside the PPO-selected risk corridor, so it does not require the alert.`
                : `${vehicleId} did not enter the current incident's candidate set, so AI sent no alert.`
  return <aside className="vehicle-question-card" aria-label="Vehicle decision inquiry">
    <p className="hud-kicker">VEHICLE DECISION INQUIRY</p>
    <div className="vehicle-question-heading"><strong>{vehicleId}</strong>
      <span className={ai.selected ? 'is-selected' : ''}>{ai.selected ? 'AI Notified' : 'AI Did Not Notify'}</span></div>
    <div className="vehicle-fact-row">
      <span>Candidate Status<b>{ai.candidate ? 'Inside candidate set' : 'Outside scope'}</b></span>
      <span>{method.label}<b>{baseline.selected ? 'Notifies' : 'Does not notify'}</b></span>
      <span>Incident Distance<b>{ai.distanceM === null && !relation ? '—'
        : `${(ai.distanceM ?? relation?.distance_m ?? 0).toFixed(1)} m`}</b></span>
    </div>
    <div className="vehicle-question-actions">
      <button type="button" className={question === 'why' ? 'is-active' : ''} onClick={() => setQuestion('why')}>Why?</button>
      <button type="button" className={question === 'baseline' ? 'is-active' : ''} onClick={() => setQuestion('baseline')}>What about the baseline?</button>
      <button type="button" className={question === 'stress' ? 'is-active' : ''} onClick={() => setQuestion('stress')}>What under low bandwidth?</button>
    </div>
    <p>{answer}</p>
    <small>Observed facts and interpretive cues are shown separately; attention does not establish causality.</small>
  </aside>
}

function ComparisonFootprints({ pair, baseline }: { pair: ComparisonPair; baseline: ComparisonBaseline }) {
  const vehicles = pair.ai.vehicles
  const sourceId = pair.ai.events[0]?.source_vehicle_id
  const xs = vehicles.map((vehicle) => vehicle.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const span = Math.max(1, maxX - minX)
  const lanes = [...new Set(vehicles.map((vehicle) => vehicle.y))].sort((a, b) => a - b)
  const projectX = (x: number) => 16 + (x - minX) / span * 408
  const projectY = (y: number) => 20 + Math.max(0, lanes.indexOf(y)) * 26
  const panels = [
    { key: baseline, title: baselineDefinition(baseline).label, update: pair.baseline, color: '#f0a84b' },
    { key: 'ai', title: 'AI Selective Broadcast', update: pair.ai, color: '#2dd4a3' },
  ] as const
  return <div className="comparison-footprints" aria-label="Same-scale top-down communication coverage">
    {panels.map((panel) => {
      const selected = new Set(panel.update.decision.selected_receivers)
      return <figure key={panel.key}>
        <figcaption><strong>{panel.title}</strong><span>{selected.size} receivers</span></figcaption>
        <svg viewBox="0 0 440 92" role="img"
          aria-label={`${panel.title} receiver distribution on the same-scale three-lane segment`}>
          {lanes.map((_, index) => <g key={index}>
            <line x1="10" x2="430" y1={20 + index * 26} y2={20 + index * 26}
              stroke="#52606d" strokeWidth="1" />
          </g>)}
          {vehicles.map((vehicle) => {
            const source = vehicle.id === sourceId
            const active = selected.has(vehicle.id)
            return <circle key={vehicle.id} cx={projectX(vehicle.x)} cy={projectY(vehicle.y)}
              r={source ? 4.2 : active ? 3.2 : 2.4}
              fill={source ? '#ef5350' : active ? panel.color : '#53606b'}
              stroke={source ? '#ffd2cc' : active ? '#e8fffa' : 'transparent'} strokeWidth="0.8" />
          })}
        </svg>
      </figure>
    })}
  </div>
}

const HELDOUT_METRICS = [
  { key: 'affected_vehicle_coverage', label: 'Affected-Vehicle Coverage', unit: '%', scale: 100 },
  { key: 'communication_overhead', label: 'Message Overhead', unit: '', scale: 1 },
  { key: 'normalized_channel_cost', label: 'Normalized Channel Cost', unit: '', scale: 1 },
  { key: 'p95_latency_ms', label: 'P95 Latency', unit: ' ms', scale: 1 },
] as const

const METHOD_NAMES: Record<string, string> = {
  ai: 'Transformer + PPO', broadcast: 'Broadcast', distance: 'Fixed Radius', urgency: 'Urgency Scheduling',
}

function HeldoutMethodTable({ results }: { results: DemoResultsSummary | null }) {
  if (!results?.ready) return <div className="heldout-pending">
    <strong>Held-out results are waiting for the training pipeline</strong><span>{results?.reason ?? 'Four-method results will appear automatically when ready'}</span>
  </div>
  return <section className="all-method-results" aria-labelledby="heldout-heading">
    <header><div><small>HELD-OUT EVALUATION</small><strong id="heldout-heading">Unified Four-Method Held-Out Set</strong></div>
      <span>{results.case_count ?? '—'} cases · protocol {results.protocol}</span></header>
    <div role="table" aria-label="Four-method held-out metric comparison">
      <div className="all-method-results__head" role="row"><b role="columnheader">Method</b>
        {HELDOUT_METRICS.map((metric) => <b role="columnheader" key={metric.key}>{metric.label}</b>)}</div>
      {(['ai', 'broadcast', 'distance', 'urgency'] as const).map((method) => <div
        className={`all-method-results__row ${method === 'ai' ? 'is-ai' : ''}`} role="row" key={method}>
        <strong role="rowheader">{METHOD_NAMES[method]}</strong>
        {HELDOUT_METRICS.map((metric) => {
          const value = results.methods[method]?.[metric.key]
          return <span role="cell" key={metric.key}><b>{value
            ? `${(value.mean * metric.scale).toFixed(metric.scale === 100 ? 1 : 2)}${metric.unit}` : '—'}</b>
            {value && <small>95% CI [{(value.ci95[0] * metric.scale).toFixed(1)}, {(value.ci95[1] * metric.scale).toFixed(1)}]</small>}</span>
        })}
      </div>)}
    </div>
    <p className="heldout-method-note">Fixed Radius and Urgency Scheduling use the same 300 m receiver set; the latter differs through severity-driven priority, bandwidth, and channel cost.</p>
  </section>
}

function resultTagline(pair: ComparisonPair | null): string {
  if (!pair) return 'Refer to measured data from the same scenario'
  const baselineCount = new Set(pair.baseline.decision.selected_receivers).size
  const aiCount = new Set(pair.ai.decision.selected_receivers).size
  const claims = [aiCount < baselineCount ? 'Fewer notifications' : 'Comparable receiver count']
  claims.push(aiCount < baselineCount ? 'Lower load' : 'Limited load benefit')
  claims.push(pair.ai.metrics.avg_delay_ms < pair.baseline.metrics.avg_delay_ms ? 'Better latency' : 'No latency advantage')
  return `${claims.join(' · ')} · Results shown without embellishment`
}

function FinalComparison({ pair, source, results, baseline, visibleMetricCount, showTagline,
  environmentLabel, onOpenValidation }: {
  pair: ComparisonPair | null
  source: PresentationSource
  results: DemoResultsSummary | null
  baseline: ComparisonBaseline
  visibleMetricCount: number
  showTagline: boolean
  environmentLabel: string
  onOpenValidation: () => void
}) {
  const metrics = comparisonMetrics(pair, source === 'real')
  const method = baselineDefinition(baseline)
  return (
    <section className="final-comparison" aria-labelledby="comparison-heading">
      <div className="final-heading">
        <p className="hud-kicker">{environmentLabel} · SAME INCIDENT · SAME TIMESTAMP</p>
        <h2 id="comparison-heading">Communication Strategy Results</h2>
      </div>
      <div className="final-comparison__body">
        <section className="case-comparison">
          {pair && <ComparisonFootprints pair={pair} baseline={baseline} />}
          <div className="comparison-method-headings" aria-hidden="true">
            <span><Satellite />{method.label}</span><span><ShieldCheck />AI Selective Broadcast</span>
          </div>
          <div className="comparison-table" role="table" aria-label={`${method.label} and AI selective broadcast metric comparison`}>
            {metrics.map((metric, index) => <div
              className={`comparison-row ${index < visibleMetricCount ? 'comparison-row--visible' : ''}`}
              role="row" key={metric.label}>
              <strong role="rowheader">{metric.label}</strong>
              <span role="cell">{metric.baseline}</span>
              <span role="cell">{metric.ai}</span>
              <em>{metric.delta ?? '—'}</em>
            </div>)}
          </div>
          <p className={`final-conclusion ${visibleMetricCount >= 4 ? 'final-conclusion--visible' : ''}`}>
            {conclusionFor(pair, source === 'real')}
          </p>
          <strong className={`final-tagline ${showTagline ? 'final-tagline--visible' : ''}`}>
            {resultTagline(pair)}
          </strong>
          <button type="button" className={`open-validation-action ${showTagline ? 'is-visible' : ''}`}
            onClick={onOpenValidation}><FlaskConical aria-hidden="true" />Validate This Result</button>
        </section>
        <HeldoutMethodTable results={results} />
      </div>
    </section>
  )
}
