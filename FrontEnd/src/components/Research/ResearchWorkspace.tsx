import {
  Bot, BookOpen, CarFront, CheckCircle2, ChevronDown, Download, FlaskConical,
  Gauge, GitCompareArrows, ListFilter, Network, Pause, Play, Radio, Save,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { buildFallbackComparison } from '../Presentation/presentationFallback'
import type { EditorScenario } from '../SceneEditor/sceneTypes'
import { Scene3D } from '../ThreeD/Scene3D'
import {
  presentationEnvironmentDefinition,
  type PresentationAtmosphere,
  type PresentationEnvironment,
  type RenderPreference,
} from '../ThreeD/environmentPresets'
import { DEFAULT_MODEL, useSimulationSession } from '../../hooks/useSimulationSession'
import type { ComparisonPair, SimulationTransmission, StateUpdateMessage } from '../../types/simulation'
import {
  configuredScenario,
  DEFAULT_NETWORK_OVERRIDES,
  evidenceFrameIndex,
  evidenceForVehicle,
  RESEARCH_EVIDENCE_FRAME_FROZEN,
  type ExperimentNotebookEntry,
  type ExperimentPreset,
  type ExperimentPreview,
  type NetworkOverrides,
} from '../../types/research'

type ResearchWorkspaceProps = {
  scenario: EditorScenario
  presentationPairs: ComparisonPair[]
  presentationSource: 'real' | 'rule' | null
  modelEligible: boolean
  modelReason: string | null
  initialTask?: ValidationTask
  environmentPreset: PresentationEnvironment
  atmosphere: PresentationAtmosphere
  renderPreference: RenderPreference
}

export type ValidationTask = 'decision' | 'stress' | 'evidence'
type SideView = 'evidence' | 'relations' | 'copilot'
type DrawerView = 'trace' | 'compare' | 'experiment' | 'notebook'
type Strategy = 'ai' | 'baseline'

const NOTEBOOK_KEY = 'g11-v2x-research-notebook-v1'

function loadNotebook(): ExperimentNotebookEntry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(NOTEBOOK_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value as ExperimentNotebookEntry[] : []
  } catch {
    return []
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function differenceMessages(pair: ComparisonPair, strategy: Strategy, onlyDifferences: boolean) {
  const active = strategy === 'ai' ? pair.ai : pair.baseline
  if (!onlyDifferences) return active.messages
  const other = strategy === 'ai' ? pair.baseline : pair.ai
  const otherReceivers = new Set(other.messages.map((message) => message.to))
  return active.messages.filter((message) => !otherReceivers.has(message.to))
}

function MetricCard({ label, ai, baseline, unit = '', aiLabel = 'AI' }: {
  label: string; ai: number; baseline: number; unit?: string; aiLabel?: string
}) {
  const improvement = baseline === 0 ? 0 : (baseline - ai) / baseline
  return <article className="research-metric-card">
    <span>{label}</span>
    <div><strong>{ai.toFixed(label === 'Notified Vehicles' ? 0 : 1)}{unit}</strong><small>{aiLabel}</small></div>
    <div><b>{baseline.toFixed(label === 'Notified Vehicles' ? 0 : 1)}{unit}</b><small>Baseline</small></div>
    <em className={improvement > 0 ? 'is-improved' : improvement < 0 ? 'is-degraded' : ''}>
      {improvement > 0 ? `${(improvement * 100).toFixed(0)}% improvement` : improvement < 0 ? 'Degraded' : 'No material change'}
    </em>
  </article>
}

function EvidencePanel({ update, vehicleId, accidentVehicleId, source, selectiveLabel }: {
  update: StateUpdateMessage
  vehicleId: string
  accidentVehicleId: string
  source: 'real' | 'rule'
  selectiveLabel: string
}) {
  const evidence = evidenceForVehicle(update, vehicleId)
  const vehicle = update.vehicles.find((item) => item.id === vehicleId)
  const speed = vehicle ? Math.hypot(vehicle.vx, vehicle.vy) * 3.6 : 0
  if (vehicleId === accidentVehicleId) return <div className="research-panel-content">
    <div className="evidence-identity evidence-identity--sender">
      <CarFront aria-hidden="true" /><div><span>Incident Message Source</span><strong>{vehicleId}</strong></div><b className="status-chip">Sender</b>
    </div>
    <section className="evidence-reason"><span>How to Validate the Selection Policy</span><p>The incident vehicle is the message sender and is not part of the receiver set. Select another vehicle to compare the baseline and {selectiveLabel} decisions vehicle by vehicle.</p></section>
  </div>
  return <div className="research-panel-content">
    <div className="evidence-identity">
      <CarFront aria-hidden="true" />
      <div><span>Current Inspection Target</span><strong>{vehicleId}</strong></div>
      <b className={evidence.selected ? 'status-chip status-chip--selected' : 'status-chip'}>
        {evidence.selected ? 'Notified' : evidence.candidate ? 'Candidate Not Selected' : 'Irrelevant Vehicle'}
      </b>
    </div>
    <dl className="evidence-grid">
      <div><dt>Live Speed</dt><dd>{speed.toFixed(0)} km/h</dd></div>
      <div><dt>Incident Distance</dt><dd>{evidence.distanceM === null ? 'Outside scope' : `${evidence.distanceM.toFixed(1)} m`}</dd></div>
      <div><dt>{source === 'real' ? 'Relative Attention' : 'Rule Score'}</dt><dd>{evidence.attention === null ? 'Not provided' : formatPercent(evidence.attention)}</dd></div>
      <div><dt>Allocated Bandwidth</dt><dd>{evidence.bandwidth === null ? '—' : formatPercent(evidence.bandwidth)}</dd></div>
      <div><dt>Message Outcome</dt><dd>{evidence.delayMs === null ? 'Not sent' : evidence.delivered ? 'Delivered' : 'Timeout'}</dd></div>
      <div><dt>Communication Latency</dt><dd>{evidence.delayMs === null ? '—' : `${evidence.delayMs.toFixed(1)} ms`}</dd></div>
    </dl>
    <section className="evidence-reason"><span>Policy Record</span><p>{evidence.reason}</p></section>
    <p className="research-disclaimer">{source === 'real'
      ? 'Attention represents relative weight within the model input. It is a selection cue, not a strict causal explanation.'
      : 'This is a structured rule preview and contains no model-attention or PPO-inference evidence.'}</p>
  </div>
}

function RelationsPanel({ update, onSelect }: {
  update: StateUpdateMessage; onSelect: (vehicleId: string) => void
}) {
  const weights = new Map<string, number>()
  for (const item of update.attention_weights ?? []) {
    weights.set(item.vehicle_id, Math.max(weights.get(item.vehicle_id) ?? 0, item.weight))
  }
  const selected = new Set(update.decision.selected_receivers)
  const candidates = [...(update.decision.candidate_vehicles ?? [])]
    .sort((left, right) => (weights.get(right.id) ?? 0) - (weights.get(left.id) ?? 0))
  const maximum = Math.max(0.001, ...candidates.map((item) => weights.get(item.id) ?? 0))
  return <div className="research-panel-content relation-explorer">
    <div className="relation-legend">
      <span><i className="relation-dot relation-dot--selected" />Final Selection</span>
      <span><i className="relation-dot relation-dot--candidate" />Candidate Set</span>
    </div>
    {candidates.length === 0 ? <p className="research-empty">No candidate relations exist at this timestamp.</p> : candidates.map((candidate) => {
      const weight = weights.get(candidate.id) ?? 0
      return <button type="button" key={candidate.id} className="relation-row" onClick={() => onSelect(candidate.id)}>
        <span><strong>{candidate.id}</strong><small>{candidate.distance_m.toFixed(0)} m</small></span>
        <i><b style={{ width: `${Math.max(4, weight / maximum * 100)}%` }} /></i>
        <em className={selected.has(candidate.id) ? 'is-selected' : ''}>
          {selected.has(candidate.id) ? 'Selected' : 'Candidate'}
        </em>
      </button>
    })}
  </div>
}

function CopilotPanel({ update, vehicleId, onLocate, onOpenExperiment }: {
  update: StateUpdateMessage
  vehicleId: string
  onLocate: () => void
  onOpenExperiment: () => void
}) {
  const [answer, setAnswer] = useState('Select a quick question. The system will answer only from current simulation evidence.')
  const [items, setItems] = useState<{ label: string; value: string; source: string }[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async (query: string) => {
    const evidence = evidenceForVehicle(update, vehicleId)
    setLoading(true)
    try {
      const response = await fetch('/api/v1/copilot/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query, vehicle_id: vehicleId,
          evidence: {
            vehicle_id: vehicleId, candidate: evidence.candidate, selected: evidence.selected,
            distance_m: evidence.distanceM, attention: evidence.attention,
            reason: evidence.reason, timestamp: evidence.timestamp,
          },
        }),
      })
      if (!response.ok) throw new Error('Local explanation service unavailable')
      const result = await response.json() as { answer: string; evidence: typeof items }
      setAnswer(result.answer)
      setItems(result.evidence)
    } catch {
      setAnswer(evidence.selected
        ? `${vehicleId} entered the final receiver set. This offline explanation should be evaluated together with distance, policy reason, and message outcome.`
        : `${vehicleId} was not selected. This offline explanation does not present attention weight as a causal conclusion.`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  return <div className="research-panel-content copilot-panel">
    <div className="copilot-state"><Bot aria-hidden="true" /><span><strong>Local Evidence Explanation</strong><small>Bound to current evidence · Does not modify simulation</small></span></div>
    <div className="copilot-quick-actions">
      <button type="button" onClick={() => void ask(`Why was ${vehicleId} selected or not selected?`)}>Why this decision?</button>
      <button type="button" onClick={() => void ask(`How does ${vehicleId} differ from broadcast?`)}>How does it differ from baseline?</button>
      <button type="button" onClick={onOpenExperiment}>Design a Low-Bandwidth Experiment</button>
    </div>
    <div className="copilot-answer" aria-live="polite">
      {loading ? <span className="copilot-loading">Checking evidence…</span> : <p>{answer}</p>}
    </div>
    {items.length > 0 && <div className="copilot-evidence-list">
      {items.map((item) => <button type="button" key={`${item.label}-${item.source}`} onClick={onLocate}>
        <span>{item.label}<small>{item.source}</small></span><strong>{item.value}</strong>
      </button>)}
    </div>}
  </div>
}

function MessageTrace({ pair, strategy, onlyDifferences, onToggleDifferences, aiLabel }: {
  pair: ComparisonPair; strategy: Strategy; onlyDifferences: boolean; onToggleDifferences: () => void; aiLabel: string
}) {
  const messages = differenceMessages(pair, strategy, onlyDifferences)
  return <div className="trace-panel">
    <div className="trace-toolbar">
      <span>{strategy === 'ai' ? `${aiLabel} Selective Broadcast` : 'Conventional Broadcast'} · {messages.length} messages</span>
      <button type="button" className={onlyDifferences ? 'is-active' : ''} onClick={onToggleDifferences}>
        <ListFilter aria-hidden="true" />Differences Only
      </button>
    </div>
    <div className="trace-table" role="table" aria-label="Communication message trace">
      <div className="trace-row trace-row--heading" role="row"><span>Sender</span><span>Receiver</span><span>Outcome</span><span>Latency</span></div>
      {messages.length === 0 ? <p className="research-empty">No messages match the current filter.</p> : messages.map((message: SimulationTransmission, index) => <div className="trace-row" role="row" key={`${message.from}-${message.to}-${index}`}>
        <span>{message.from}</span><strong>{message.to}</strong>
        <em className={message.status === 'success' ? 'is-success' : 'is-timeout'}>{message.status === 'success' ? 'Delivered' : 'Timeout'}</em>
        <b>{message.delay_ms.toFixed(1)} ms</b>
      </div>)}
    </div>
  </div>
}

function ExperimentBuilder({ scenario, incidentVehicleId, pair, source, session, modelEligible, modelReason }: {
  scenario: EditorScenario
  incidentVehicleId: string
  pair: ComparisonPair
  source: 'real' | 'rule'
  session: ReturnType<typeof useSimulationSession>
  modelEligible: boolean
  modelReason: string | null
}) {
  const [network, setNetwork] = useState<NetworkOverrides>(DEFAULT_NETWORK_OVERRIDES)
  const [preview, setPreview] = useState<ExperimentPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [presets, setPresets] = useState<ExperimentPreset[]>([])
  const [activePreset, setActivePreset] = useState('normal')
  useEffect(() => {
    fetch('/api/v1/experiments/presets')
      .then((response) => response.ok ? response.json() as Promise<ExperimentPreset[]> : Promise.reject())
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])
  const update = <K extends keyof NetworkOverrides>(key: K, value: NetworkOverrides[K]) => {
    setNetwork((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setMessage(null)
  }
  const createPreview = async () => {
    setLoading(true); setMessage(null)
    try {
      const response = await fetch('/api/v1/experiments/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: configuredScenario(scenario, incidentVehicleId), network, seed: 42, baseline: 'broadcast' }),
      })
      if (!response.ok) throw new Error(await response.text())
      setPreview(await response.json() as ExperimentPreview)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Experiment preview failed')
    } finally { setLoading(false) }
  }
  const run = () => {
    if (!preview || !modelEligible) return
    session.start({ experimentRef: preview.experiment_ref, model: DEFAULT_MODEL, speed: 2, mode: 'comparison', baseline: 'broadcast' })
    setMessage('Experiment confirmed. Running the synchronized AI/baseline comparison.')
  }
  const selectPreset = (preset: ExperimentPreset) => {
    setActivePreset(preset.id)
    setNetwork(preset.network)
    setPreview(null)
    setMessage(preset.out_of_distribution ? 'This stress configuration may be outside the training distribution; conclusions will be marked as out of distribution.' : null)
  }
  return <div className="experiment-builder">
    <div className="experiment-hypothesis">
      <FlaskConical aria-hidden="true" /><span><strong>Counterfactual Hypothesis</strong><p>Under constrained network resources, selective broadcast should retain lower load and more stable latency than conventional broadcast.</p></span>
    </div>
    <div className="experiment-presets" aria-label="Network stress-test presets">
      {presets.length === 0 ? <span>Preset service unavailable. Parameters can still be adjusted manually.</span> : presets.map((preset) => <button
        type="button" key={preset.id} className={activePreset === preset.id ? 'is-active' : ''}
        onClick={() => selectPreset(preset)}>
        <strong>{preset.title}</strong><small>{preset.question}</small>
      </button>)}
    </div>
    <div className="parameter-grid">
      <label>Critical Radius <output>{network.critical_radius_m} m</output><input type="range" min="100" max="500" step="25" value={network.critical_radius_m} onChange={(event) => update('critical_radius_m', Number(event.target.value))} /></label>
      <label>Total Bandwidth <output>{network.total_bandwidth_mbps} Mbps</output><input type="range" min="10" max="200" step="10" value={network.total_bandwidth_mbps} onChange={(event) => update('total_bandwidth_mbps', Number(event.target.value))} /></label>
      <label>Base Latency <output>{network.base_delay_ms} ms</output><input type="range" min="0" max="100" step="5" value={network.base_delay_ms} onChange={(event) => update('base_delay_ms', Number(event.target.value))} /></label>
      <label>Far-Link Packet Loss <output>{formatPercent(network.far_packet_loss_rate)}</output><input type="range" min="0" max="0.3" step="0.01" value={network.far_packet_loss_rate} onChange={(event) => update('far_packet_loss_rate', Number(event.target.value))} /></label>
      <label>Network Model<select value={network.network_mode} onChange={(event) => update('network_mode', event.target.value as NetworkOverrides['network_mode'])}><option value="simple">Simplified Network</option><option value="3gpp">3GPP Propagation</option></select></label>
      <label>Safety Deadline <output>{network.safety_window_ms} ms</output><input type="range" min="20" max="300" step="10" value={network.safety_window_ms} onChange={(event) => update('safety_window_ms', Number(event.target.value))} /></label>
    </div>
    {preview && <div className="experiment-preview-card">
      <span><CheckCircle2 aria-hidden="true" />Parameters validated · Seed {preview.seed}</span>
      <strong>Experiment reference {preview.experiment_ref.slice(0, 8)}</strong>
      {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>}
    {message && <p className="experiment-message" aria-live="polite">{message}</p>}
    {session.errorMessage && <p className="experiment-error">{session.errorMessage}</p>}
    <div className="experiment-actions">
      <button type="button" onClick={() => void createPreview()} disabled={loading}>{loading ? 'Validating…' : 'Preview Parameter Changes'}</button>
      <button type="button" className="primary-action" onClick={run} disabled={!preview || !modelEligible || session.status === 'connecting'}><Play aria-hidden="true" />Confirm and Run</button>
    </div>
    {!modelEligible && <p className="experiment-error">{modelReason ?? 'The production AI model has not passed the eligibility gate; experiment execution is disabled.'}</p>}
    <small className="experiment-footnote">Confirmation is required before execution. The model, reward function, and feature structure are unchanged. Current evidence source: {source === 'real' ? 'production PPO comparison' : 'structured rule preview'}, {source === 'real' ? 'AI' : 'Rule'} {pair.ai.decision.selected_receivers.length} / Baseline {pair.baseline.decision.selected_receivers.length} vehicles.</small>
  </div>
}

export function ResearchWorkspace({ scenario, presentationPairs, presentationSource, modelEligible, modelReason,
  initialTask = 'decision', environmentPreset, atmosphere, renderPreference }: ResearchWorkspaceProps) {
  const incidentVehicleId = scenario.events.find((event) => event.source_vehicle_id)?.source_vehicle_id
    ?? scenario.vehicles[Math.floor(scenario.vehicles.length / 2)]?.id ?? scenario.vehicles[0].id
  const fallbackPairs = useMemo(() => buildFallbackComparison(configuredScenario(scenario, incidentVehicleId), incidentVehicleId), [incidentVehicleId, scenario])
  const session = useSimulationSession()
  const pairs = session.comparisonHistory.length > 0 ? session.comparisonHistory
    : presentationPairs.length > 0 ? presentationPairs : fallbackPairs
  const source: 'real' | 'rule' = session.comparisonHistory.length > 0 ? 'real' : presentationSource ?? 'rule'
  const selectiveLabel = source === 'real' ? 'AI' : 'Rule'
  const [frameIndex, setFrameIndex] = useState(() => evidenceFrameIndex(pairs))
  const [strategy, setStrategy] = useState<Strategy>('ai')
  const [selectedVehicleId, setSelectedVehicleId] = useState(incidentVehicleId)
  const [sideView, setSideView] = useState<SideView>('evidence')
  const [drawerView, setDrawerView] = useState<DrawerView>('trace')
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [task, setTask] = useState<ValidationTask>(initialTask)
  const [drawerCollapsed, setDrawerCollapsed] = useState(initialTask === 'decision')
  const [notebook, setNotebook] = useState<ExperimentNotebookEntry[]>(loadNotebook)

  useEffect(() => setFrameIndex(evidenceFrameIndex(pairs)), [pairs])
  useEffect(() => {
    setTask(initialTask)
    setDrawerCollapsed(initialTask === 'decision')
    setDrawerView(initialTask === 'stress' ? 'experiment' : initialTask === 'evidence' ? 'notebook' : 'trace')
  }, [initialTask])
  const pair = pairs[Math.min(frameIndex, pairs.length - 1)] ?? fallbackPairs[0]
  const update = strategy === 'ai' ? pair.ai : pair.baseline
  const candidateIds = update.decision.candidate_vehicles?.map((item) => item.id) ?? []
  const notifiedIds = update.decision.selected_receivers
  const priorities = Object.fromEntries((update.attention_weights ?? []).map((item) => [item.vehicle_id, item.weight]))
  const visibleMessages = differenceMessages(pair, strategy, onlyDifferences)
  const aiSelected = new Set(pair.ai.decision.selected_receivers)
  const differenceVehicleId = pair.baseline.decision.selected_receivers.find((id) => !aiSelected.has(id))
    ?? pair.ai.decision.candidate_vehicles?.find((item) => !aiSelected.has(item.id))?.id
    ?? selectedVehicleId
  const saveNotebook = () => {
    const entry: ExperimentNotebookEntry = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), hypothesis: `${selectiveLabel} selective broadcast reduces redundant receivers and communication load for the same incident`,
      scenarioName: scenario.name, vehicleId: incidentVehicleId, network: DEFAULT_NETWORK_OVERRIDES,
      result: { aiReceivers: pair.ai.decision.selected_receivers.length, baselineReceivers: pair.baseline.decision.selected_receivers.length, aiDelayMs: pair.ai.metrics.avg_delay_ms, baselineDelayMs: pair.baseline.metrics.avg_delay_ms },
      source,
    }
    const next = [entry, ...notebook].slice(0, 20)
    setNotebook(next); window.localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(next)); setTask('evidence'); setDrawerView('notebook'); setDrawerCollapsed(false)
  }
  const exportNotebook = () => {
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = href; anchor.download = 'v2x-experiment-notebook.json'; anchor.click(); URL.revokeObjectURL(href)
  }

  const openDrawer = (view: DrawerView) => { setDrawerView(view); setDrawerCollapsed(false) }
  const selectTask = (nextTask: ValidationTask) => {
    setTask(nextTask)
    if (nextTask === 'decision') {
      setSelectedVehicleId(differenceVehicleId)
      setSideView('evidence')
      setDrawerView('trace')
      setDrawerCollapsed(true)
    } else {
      setDrawerView(nextTask === 'stress' ? 'experiment' : 'notebook')
      setDrawerCollapsed(false)
    }
  }

  return <section className={`research-workspace research-workspace--${task}${drawerCollapsed ? ' research-workspace--drawer-collapsed' : ''}`} aria-label="V2X Validation Lab">
    <div className="research-stage">
      <Scene3D vehicles={update.vehicles} events={update.events} messages={visibleMessages}
        animationChannel={strategy === 'ai' ? 'comparison-ai' : 'comparison-baseline'}
        messageTone={strategy === 'ai' ? 'ai' : 'baseline'} candidateIds={candidateIds}
        notifiedIds={notifiedIds} selectedVehicleId={selectedVehicleId} accidentVehicleId={incidentVehicleId}
        stage="comparison" elapsedMs={18_000} strategyRole={strategy === 'ai' ? 'ai' : 'baseline'}
        freezeEvidenceFrame={RESEARCH_EVIDENCE_FRAME_FROZEN}
        environmentPreset={environmentPreset} atmosphere={atmosphere}
        renderPreference={renderPreference} bandwidthFraction={update.decision.bandwidth_fraction}
        priorityByVehicle={priorities} interactive onVehicleSelect={(id) => { setSelectedVehicleId(id); setSideView('evidence') }} />

      <div className="research-environment-badge">
        {presentationEnvironmentDefinition(environmentPreset).label} · Visual environment inherited from the presentation configuration
      </div>

      <nav className="validation-task-nav" aria-label="Validation Lab tasks">
        <button type="button" aria-pressed={task === 'decision'} className={task === 'decision' ? 'is-active' : ''} onClick={() => selectTask('decision')}>
          <CarFront aria-hidden="true" /><span><strong>Per-Vehicle Decision Audit</strong><small>Why was this vehicle notified or ignored?</small></span>
        </button>
        <button type="button" aria-pressed={task === 'stress'} className={task === 'stress' ? 'is-active' : ''} onClick={() => selectTask('stress')}>
          <FlaskConical aria-hidden="true" /><span><strong>Network Stress Experiment</strong><small>Does the policy remain effective under low bandwidth and high latency?</small></span>
        </button>
        <button type="button" aria-pressed={task === 'evidence'} className={task === 'evidence' ? 'is-active' : ''} onClick={() => selectTask('evidence')}>
          <BookOpen aria-hidden="true" /><span><strong>Evidence Log and Export</strong><small>How can this result be reproduced and submitted?</small></span>
        </button>
      </nav>

      <div className="research-toolbar research-toolbar--compact">
        <div className="strategy-switch" aria-label="Communication strategy">
          <button type="button" className={strategy === 'ai' ? 'is-active' : ''} onClick={() => setStrategy('ai')}><Radio aria-hidden="true" />{selectiveLabel} Selective</button>
          <button type="button" className={strategy === 'baseline' ? 'is-active' : ''} onClick={() => setStrategy('baseline')}><Network aria-hidden="true" />Conventional Broadcast</button>
        </div>
        <span className={`source-badge source-badge--${source}`}>{source === 'real' ? 'Production Model Evidence' : 'Rule Fallback Evidence'}</span>
        <button type="button" onClick={saveNotebook}><Save aria-hidden="true" />Save Evidence</button>
      </div>

      <div className="research-kpi-strip">
        <span><small>Current Strategy</small><strong>{strategy === 'ai' ? source === 'real' ? 'SELECTIVE AI' : 'RULE PREVIEW' : 'BROADCAST'}</strong></span>
        <span><small>Receiving Vehicles</small><strong>{update.decision.selected_receivers.length}</strong></span>
        <span><small>Average Latency</small><strong>{update.metrics.avg_delay_ms.toFixed(1)} ms</strong></span>
        <span><small>Communication Load</small><strong>{update.metrics.comm_overhead.toFixed(2)}</strong></span>
        <span><small>Delivery Rate</small><strong>{formatPercent(update.metrics.delivery_rate)}</strong></span>
      </div>

      {task === 'decision' && <aside className="research-side-panel" aria-label="Context analysis panel">
        <nav>
          <button type="button" className={sideView === 'evidence' ? 'is-active' : ''} onClick={() => setSideView('evidence')}><CarFront aria-hidden="true" />Evidence</button>
          <button type="button" className={sideView === 'relations' ? 'is-active' : ''} onClick={() => setSideView('relations')}><Network aria-hidden="true" />Relations</button>
          <button type="button" className={sideView === 'copilot' ? 'is-active' : ''} onClick={() => setSideView('copilot')}><Bot aria-hidden="true" />Explain</button>
        </nav>
        {sideView === 'evidence' && <EvidencePanel update={update} vehicleId={selectedVehicleId}
          accidentVehicleId={incidentVehicleId} source={source} selectiveLabel={selectiveLabel} />}
        {sideView === 'relations' && <RelationsPanel update={pair.ai} onSelect={(id) => { setSelectedVehicleId(id); setSideView('evidence') }} />}
        {sideView === 'copilot' && <CopilotPanel update={pair.ai} vehicleId={selectedVehicleId}
          onLocate={() => setSideView('evidence')} onOpenExperiment={() => selectTask('stress')} />}
      </aside>}
    </div>

    <section className="research-drawer" aria-label="Experiment data drawer">
      <div className="drawer-heading">
        <nav>
          {task === 'decision' && <><button type="button" className={drawerView === 'trace' ? 'is-active' : ''} onClick={() => openDrawer('trace')}><Radio aria-hidden="true" />Message Trace</button>
            <button type="button" className={drawerView === 'compare' ? 'is-active' : ''} onClick={() => openDrawer('compare')}><GitCompareArrows aria-hidden="true" />Synchronized Metrics</button></>}
          {task === 'stress' && <button type="button" className="is-active"><SlidersHorizontal aria-hidden="true" />Network Stress Experiment · Results remain in the lab</button>}
          {task === 'evidence' && <button type="button" className="is-active"><BookOpen aria-hidden="true" />Reproducible Experiment Log</button>}
        </nav>
        {task === 'decision' && <button type="button" className="drawer-collapse" aria-label={drawerCollapsed ? 'Expand experiment drawer' : 'Collapse experiment drawer'}
          aria-expanded={!drawerCollapsed} onClick={() => setDrawerCollapsed((value) => !value)}><ChevronDown aria-hidden="true" /></button>
        }
      </div>
      {!drawerCollapsed && <><div className="drawer-body">
        {drawerView === 'trace' && <MessageTrace pair={pair} strategy={strategy} onlyDifferences={onlyDifferences} onToggleDifferences={() => setOnlyDifferences((value) => !value)} aiLabel={selectiveLabel} />}
        {drawerView === 'compare' && <div className="comparison-board">
          <MetricCard label="Notified Vehicles" ai={pair.ai.decision.selected_receivers.length} baseline={pair.baseline.decision.selected_receivers.length} aiLabel={selectiveLabel} />
          <MetricCard label="Average Latency" ai={pair.ai.metrics.avg_delay_ms} baseline={pair.baseline.metrics.avg_delay_ms} unit=" ms" aiLabel={selectiveLabel} />
          <MetricCard label="Communication Load" ai={pair.ai.metrics.comm_overhead} baseline={pair.baseline.metrics.comm_overhead} aiLabel={selectiveLabel} />
          <MetricCard label="Non-Delivery Rate" ai={1 - pair.ai.metrics.delivery_rate} baseline={1 - pair.baseline.metrics.delivery_rate} aiLabel={selectiveLabel} />
        </div>}
          {drawerView === 'experiment' && <ExperimentBuilder scenario={scenario} incidentVehicleId={incidentVehicleId} pair={pair} source={source} session={session} modelEligible={modelEligible} modelReason={modelReason} />}
        {drawerView === 'notebook' && <div className="notebook-panel">
          <div className="notebook-toolbar"><span>{notebook.length} reproducible experiment records</span><button type="button" onClick={exportNotebook} disabled={notebook.length === 0}><Download aria-hidden="true" />Export JSON</button></div>
          {notebook.length === 0 ? <p className="research-empty">Select “Save Evidence” above the scene to record the current comparison.</p> : notebook.map((entry) => <article key={entry.id}>
            <span><strong>{entry.scenarioName}</strong><small>{new Date(entry.createdAt).toLocaleString('en-US')}</small></span>
            <p>{entry.hypothesis}</p><b>{entry.source === 'real' ? 'AI' : 'Rule'} {entry.result.aiReceivers} vehicles / Baseline {entry.result.baselineReceivers} vehicles</b>
          </article>)}
        </div>}
      </div>
      <div className="research-timeline">
        <button type="button" onClick={() => session.control(session.playing ? 'pause' : 'play')} disabled={session.status !== 'connected'}>{session.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
        <Gauge aria-hidden="true" /><span>{pair.ai.timestamp.toFixed(1)} s</span>
        <input aria-label="Synchronized experiment timeline" type="range" min="0" max={Math.max(0, pairs.length - 1)} value={Math.min(frameIndex, pairs.length - 1)} onChange={(event) => setFrameIndex(Number(event.target.value))} />
        <small>Incident → Decision → Transmission → Delivery</small>
      </div></>}
    </section>
  </section>
}
