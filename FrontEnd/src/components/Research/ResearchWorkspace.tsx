import {
  Bot, BookOpen, CarFront, CheckCircle2, ChevronDown, Download, FlaskConical,
  Gauge, GitCompareArrows, ListFilter, Network, Pause, Play, Radio, Save,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { buildFallbackComparison } from '../Presentation/presentationFallback'
import type { EditorScenario } from '../SceneEditor/sceneTypes'
import { Scene3D } from '../ThreeD/Scene3D'
import { DEFAULT_MODEL, useSimulationSession } from '../../hooks/useSimulationSession'
import type { ComparisonPair, SimulationTransmission, StateUpdateMessage } from '../../types/simulation'
import {
  configuredScenario,
  DEFAULT_NETWORK_OVERRIDES,
  evidenceFrameIndex,
  evidenceForVehicle,
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
}

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
    <div><strong>{ai.toFixed(label === '通知车辆' ? 0 : 1)}{unit}</strong><small>{aiLabel}</small></div>
    <div><b>{baseline.toFixed(label === '通知车辆' ? 0 : 1)}{unit}</b><small>传统</small></div>
    <em className={improvement > 0 ? 'is-improved' : improvement < 0 ? 'is-degraded' : ''}>
      {improvement > 0 ? `改善 ${(improvement * 100).toFixed(0)}%` : improvement < 0 ? '有所下降' : '基本不变'}
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
      <CarFront aria-hidden="true" /><div><span>事故消息发送源</span><strong>{vehicleId}</strong></div><b className="status-chip">发送方</b>
    </div>
    <section className="evidence-reason"><span>如何验证选择策略</span><p>事故车不是接收者选择对象。进入“车辆证据”步骤后，系统会定位一辆传统广播通知、{selectiveLabel}未通知的差异车辆。</p></section>
  </div>
  return <div className="research-panel-content">
    <div className="evidence-identity">
      <CarFront aria-hidden="true" />
      <div><span>当前检查对象</span><strong>{vehicleId}</strong></div>
      <b className={evidence.selected ? 'status-chip status-chip--selected' : 'status-chip'}>
        {evidence.selected ? '已通知' : evidence.candidate ? '候选未选' : '无关车辆'}
      </b>
    </div>
    <dl className="evidence-grid">
      <div><dt>实时速度</dt><dd>{speed.toFixed(0)} km/h</dd></div>
      <div><dt>事件距离</dt><dd>{evidence.distanceM === null ? '范围外' : `${evidence.distanceM.toFixed(1)} m`}</dd></div>
      <div><dt>{source === 'real' ? '相对注意力' : '规则评分'}</dt><dd>{evidence.attention === null ? '未提供' : formatPercent(evidence.attention)}</dd></div>
      <div><dt>分配带宽</dt><dd>{evidence.bandwidth === null ? '—' : formatPercent(evidence.bandwidth)}</dd></div>
      <div><dt>消息结果</dt><dd>{evidence.delayMs === null ? '未发送' : evidence.delivered ? '成功送达' : '超时'}</dd></div>
      <div><dt>通信时延</dt><dd>{evidence.delayMs === null ? '—' : `${evidence.delayMs.toFixed(1)} ms`}</dd></div>
    </dl>
    <section className="evidence-reason"><span>策略记录</span><p>{evidence.reason}</p></section>
    <p className="research-disclaimer">{source === 'real'
      ? '注意力表示模型输入中的相对权重，仅作为选择线索，不代表严格因果关系。'
      : '当前为规则结构预览，不包含模型注意力或 PPO 推理证据。'}</p>
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
      <span><i className="relation-dot relation-dot--selected" />最终选择</span>
      <span><i className="relation-dot relation-dot--candidate" />候选集合</span>
    </div>
    {candidates.length === 0 ? <p className="research-empty">当前时刻没有候选关系。</p> : candidates.map((candidate) => {
      const weight = weights.get(candidate.id) ?? 0
      return <button type="button" key={candidate.id} className="relation-row" onClick={() => onSelect(candidate.id)}>
        <span><strong>{candidate.id}</strong><small>{candidate.distance_m.toFixed(0)} m</small></span>
        <i><b style={{ width: `${Math.max(4, weight / maximum * 100)}%` }} /></i>
        <em className={selected.has(candidate.id) ? 'is-selected' : ''}>
          {selected.has(candidate.id) ? '已选' : '候选'}
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
  const [answer, setAnswer] = useState('选择一个快捷问题，副驾驶会只基于当前仿真证据作答。')
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
      if (!response.ok) throw new Error('副驾驶服务不可用')
      const result = await response.json() as { answer: string; evidence: typeof items }
      setAnswer(result.answer)
      setItems(result.evidence)
    } catch {
      setAnswer(evidence.selected
        ? `${vehicleId} 已进入最终接收集合。当前为离线解释，建议结合距离、策略理由和消息结果共同判断。`
        : `${vehicleId} 未被最终选择。当前为离线解释，不将注意力权重表述为因果结论。`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  return <div className="research-panel-content copilot-panel">
    <div className="copilot-state"><Bot aria-hidden="true" /><span><strong>Research Copilot</strong><small>本地证据模式 · 不修改仿真</small></span></div>
    <div className="copilot-quick-actions">
      <button type="button" onClick={() => void ask(`为什么选择或不选择 ${vehicleId}`)}>为什么选择它？</button>
      <button type="button" onClick={() => void ask(`${vehicleId} 与传统广播有什么差异`)}>与基线有何差异？</button>
      <button type="button" onClick={onOpenExperiment}>设计低带宽实验</button>
    </div>
    <div className="copilot-answer" aria-live="polite">
      {loading ? <span className="copilot-loading">正在核对证据…</span> : <p>{answer}</p>}
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
      <span>{strategy === 'ai' ? `${aiLabel}选择性广播` : '传统广播'} · {messages.length} 条消息</span>
      <button type="button" className={onlyDifferences ? 'is-active' : ''} onClick={onToggleDifferences}>
        <ListFilter aria-hidden="true" />仅看差异
      </button>
    </div>
    <div className="trace-table" role="table" aria-label="通信消息追踪">
      <div className="trace-row trace-row--heading" role="row"><span>发送方</span><span>接收方</span><span>结果</span><span>时延</span></div>
      {messages.length === 0 ? <p className="research-empty">当前筛选条件下没有消息。</p> : messages.map((message: SimulationTransmission, index) => <div className="trace-row" role="row" key={`${message.from}-${message.to}-${index}`}>
        <span>{message.from}</span><strong>{message.to}</strong>
        <em className={message.status === 'success' ? 'is-success' : 'is-timeout'}>{message.status === 'success' ? '送达' : '超时'}</em>
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
      setMessage(error instanceof Error ? error.message : '实验预览失败')
    } finally { setLoading(false) }
  }
  const run = () => {
    if (!preview || !modelEligible) return
    session.start({ experimentRef: preview.experiment_ref, model: DEFAULT_MODEL, speed: 2, mode: 'comparison', baseline: 'broadcast' })
    setMessage('实验已确认，正在运行同步AI/基线对比。')
  }
  const selectPreset = (preset: ExperimentPreset) => {
    setActivePreset(preset.id)
    setNetwork(preset.network)
    setPreview(null)
    setMessage(preset.out_of_distribution ? '该压力配置可能超出训练分布，结论将带分布外标记。' : null)
  }
  return <div className="experiment-builder">
    <div className="experiment-hypothesis">
      <FlaskConical aria-hidden="true" /><span><strong>反事实假设</strong><p>降低网络资源后，选择性广播应比传统全量广播保持更低负载与更稳定时延。</p></span>
    </div>
    <div className="experiment-presets" aria-label="网络压力测试预设">
      {presets.length === 0 ? <span>预设服务不可用，可继续手动调整参数。</span> : presets.map((preset) => <button
        type="button" key={preset.id} className={activePreset === preset.id ? 'is-active' : ''}
        onClick={() => selectPreset(preset)}>
        <strong>{preset.title}</strong><small>{preset.question}</small>
      </button>)}
    </div>
    <div className="parameter-grid">
      <label>关键半径 <output>{network.critical_radius_m} m</output><input type="range" min="100" max="500" step="25" value={network.critical_radius_m} onChange={(event) => update('critical_radius_m', Number(event.target.value))} /></label>
      <label>总带宽 <output>{network.total_bandwidth_mbps} Mbps</output><input type="range" min="10" max="200" step="10" value={network.total_bandwidth_mbps} onChange={(event) => update('total_bandwidth_mbps', Number(event.target.value))} /></label>
      <label>基础时延 <output>{network.base_delay_ms} ms</output><input type="range" min="0" max="100" step="5" value={network.base_delay_ms} onChange={(event) => update('base_delay_ms', Number(event.target.value))} /></label>
      <label>远端丢包 <output>{formatPercent(network.far_packet_loss_rate)}</output><input type="range" min="0" max="0.3" step="0.01" value={network.far_packet_loss_rate} onChange={(event) => update('far_packet_loss_rate', Number(event.target.value))} /></label>
      <label>网络模型<select value={network.network_mode} onChange={(event) => update('network_mode', event.target.value as NetworkOverrides['network_mode'])}><option value="simple">简化网络</option><option value="3gpp">3GPP传播</option></select></label>
      <label>安全时限 <output>{network.safety_window_ms} ms</output><input type="range" min="20" max="300" step="10" value={network.safety_window_ms} onChange={(event) => update('safety_window_ms', Number(event.target.value))} /></label>
    </div>
    {preview && <div className="experiment-preview-card">
      <span><CheckCircle2 aria-hidden="true" />参数已验证 · 种子 {preview.seed}</span>
      <strong>实验引用 {preview.experiment_ref.slice(0, 8)}</strong>
      {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>}
    {message && <p className="experiment-message" aria-live="polite">{message}</p>}
    {session.errorMessage && <p className="experiment-error">{session.errorMessage}</p>}
    <div className="experiment-actions">
      <button type="button" onClick={() => void createPreview()} disabled={loading}>{loading ? '正在验证…' : '预览参数差异'}</button>
      <button type="button" className="primary-action" onClick={run} disabled={!preview || !modelEligible || session.status === 'connecting'}><Play aria-hidden="true" />确认并运行</button>
    </div>
    {!modelEligible && <p className="experiment-error">{modelReason ?? '正式AI模型尚未通过资格门禁，实验运行已禁用。'}</p>}
    <small className="experiment-footnote">运行前必须确认；模型、奖励函数与特征结构不会被修改。当前证据来源：{source === 'real' ? '真实PPO对比' : '规则结构预览'}，{source === 'real' ? 'AI' : '规则'} {pair.ai.decision.selected_receivers.length} / 传统 {pair.baseline.decision.selected_receivers.length} 辆。</small>
  </div>
}

export function ResearchWorkspace({ scenario, presentationPairs, presentationSource, modelEligible, modelReason }: ResearchWorkspaceProps) {
  const incidentVehicleId = scenario.events.find((event) => event.source_vehicle_id)?.source_vehicle_id
    ?? scenario.vehicles[Math.floor(scenario.vehicles.length / 2)]?.id ?? scenario.vehicles[0].id
  const fallbackPairs = useMemo(() => buildFallbackComparison(configuredScenario(scenario, incidentVehicleId), incidentVehicleId), [incidentVehicleId, scenario])
  const session = useSimulationSession()
  const pairs = session.comparisonHistory.length > 0 ? session.comparisonHistory
    : presentationPairs.length > 0 ? presentationPairs : fallbackPairs
  const source: 'real' | 'rule' = session.comparisonHistory.length > 0 ? 'real' : presentationSource ?? 'rule'
  const selectiveLabel = source === 'real' ? 'AI' : '规则'
  const [frameIndex, setFrameIndex] = useState(() => evidenceFrameIndex(pairs))
  const [strategy, setStrategy] = useState<Strategy>('ai')
  const [selectedVehicleId, setSelectedVehicleId] = useState(incidentVehicleId)
  const [sideView, setSideView] = useState<SideView>('evidence')
  const [drawerView, setDrawerView] = useState<DrawerView>('trace')
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [drawerCollapsed, setDrawerCollapsed] = useState(true)
  const [validationStep, setValidationStep] = useState(1)
  const [notebook, setNotebook] = useState<ExperimentNotebookEntry[]>(loadNotebook)

  useEffect(() => setFrameIndex(evidenceFrameIndex(pairs)), [pairs])
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
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), hypothesis: `${selectiveLabel}选择性广播在同一事故下减少冗余接收者与通信负载`,
      scenarioName: scenario.name, vehicleId: incidentVehicleId, network: DEFAULT_NETWORK_OVERRIDES,
      result: { aiReceivers: pair.ai.decision.selected_receivers.length, baselineReceivers: pair.baseline.decision.selected_receivers.length, aiDelayMs: pair.ai.metrics.avg_delay_ms, baselineDelayMs: pair.baseline.metrics.avg_delay_ms },
      source,
    }
    const next = [entry, ...notebook].slice(0, 20)
    setNotebook(next); window.localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(next)); setDrawerView('notebook'); setDrawerCollapsed(false)
  }
  const exportNotebook = () => {
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = href; anchor.download = 'v2x-experiment-notebook.json'; anchor.click(); URL.revokeObjectURL(href)
  }

  const openDrawer = (view: DrawerView) => { setDrawerView(view); setDrawerCollapsed(false) }
  const goValidationStep = (step: number) => {
    setValidationStep(step)
    if (step === 1) { setDrawerCollapsed(true); setSideView('evidence') }
    if (step === 2) { setSelectedVehicleId(differenceVehicleId); setSideView('evidence'); setDrawerCollapsed(true) }
    if (step === 3) openDrawer('compare')
    if (step === 4) openDrawer('experiment')
  }
  const validationCopy = [
    { title: '确认公平比较', detail: source === 'real'
      ? `同一事故 · 种子42 · 时间戳 ${pair.ai.timestamp.toFixed(1)}s`
      : '当前为规则回退证据；需要现场真实运行后确认PPO结论', action: source === 'real' ? '确认可比' : '继续检查结构' },
    { title: '检查车辆决策', detail: `推荐追问 ${differenceVehicleId}：传统通知、${selectiveLabel}未通知`, action: '确认车辆差异' },
    { title: '比较策略结果', detail: `${selectiveLabel}通知 ${pair.ai.decision.selected_receivers.length} 辆，传统通知 ${pair.baseline.decision.selected_receivers.length} 辆`, action: '指标已确认，继续' },
    { title: '进行压力测试', detail: '选择低带宽、高时延或高丢包预设，再确认现场运行', action: '打开压力预设' },
  ][validationStep - 1]

  return <section className={`research-workspace${drawerCollapsed ? ' research-workspace--drawer-collapsed' : ''}`} aria-label="V2X研究实验台">
    <div className="research-stage">
      <Scene3D vehicles={update.vehicles} events={update.events} messages={visibleMessages}
        animationChannel={strategy === 'ai' ? 'comparison-ai' : 'comparison-baseline'}
        messageTone={strategy === 'ai' ? 'ai' : 'baseline'} candidateIds={candidateIds}
        notifiedIds={notifiedIds} selectedVehicleId={selectedVehicleId} accidentVehicleId={incidentVehicleId}
        stage={strategy === 'ai' ? 'ai' : 'broadcast'} elapsedMs={strategy === 'ai' ? 25_000 : 15_000}
        priorityByVehicle={priorities} interactive onVehicleSelect={(id) => { setSelectedVehicleId(id); setSideView('evidence') }} />

      <div className="validation-guide">
        <div className="validation-title"><span>验证任务</span><strong>{source === 'real' ? 'AI选择性广播是否有效？' : '规则结构预览（非AI证据）'}</strong></div>
        <nav aria-label="验证步骤">{[1, 2, 3, 4].map((step) => <button type="button" key={step}
          className={step === validationStep ? 'is-active' : step < validationStep ? 'is-complete' : ''}
          onClick={() => goValidationStep(step)}><span>{step < validationStep ? '✓' : step}</span>
          {['公平性', '车辆证据', '结果', '压力测试'][step - 1]}</button>)}</nav>
        <div className="validation-current"><span><strong>{validationCopy.title}</strong><small>{validationCopy.detail}</small></span>
          <button type="button" onClick={() => goValidationStep(Math.min(4, validationStep + 1))}>{validationCopy.action}</button></div>
      </div>

      <div className="research-toolbar research-toolbar--compact">
        <div className="strategy-switch" aria-label="通信策略">
          <button type="button" className={strategy === 'ai' ? 'is-active' : ''} onClick={() => setStrategy('ai')}><Radio aria-hidden="true" />{selectiveLabel}选择性</button>
          <button type="button" className={strategy === 'baseline' ? 'is-active' : ''} onClick={() => setStrategy('baseline')}><Network aria-hidden="true" />传统广播</button>
        </div>
        <span className={`source-badge source-badge--${source}`}>{source === 'real' ? '真实模型证据' : '规则回退证据'}</span>
        <button type="button" onClick={saveNotebook}><Save aria-hidden="true" />保存证据</button>
      </div>

      <div className="research-kpi-strip">
        <span><small>当前策略</small><strong>{strategy === 'ai' ? source === 'real' ? 'SELECTIVE AI' : 'RULE PREVIEW' : 'BROADCAST'}</strong></span>
        <span><small>接收车辆</small><strong>{update.decision.selected_receivers.length}</strong></span>
        <span><small>平均时延</small><strong>{update.metrics.avg_delay_ms.toFixed(1)} ms</strong></span>
        <span><small>通信负载</small><strong>{update.metrics.comm_overhead.toFixed(2)}</strong></span>
        <span><small>送达率</small><strong>{formatPercent(update.metrics.delivery_rate)}</strong></span>
      </div>

      <aside className="research-side-panel" aria-label="上下文分析面板">
        <nav>
          <button type="button" className={sideView === 'evidence' ? 'is-active' : ''} onClick={() => setSideView('evidence')}><CarFront aria-hidden="true" />证据</button>
          <button type="button" className={sideView === 'relations' ? 'is-active' : ''} onClick={() => setSideView('relations')}><Network aria-hidden="true" />关系</button>
          <button type="button" className={sideView === 'copilot' ? 'is-active' : ''} onClick={() => setSideView('copilot')}><Bot aria-hidden="true" />副驾驶</button>
        </nav>
        {sideView === 'evidence' && <EvidencePanel update={update} vehicleId={selectedVehicleId}
          accidentVehicleId={incidentVehicleId} source={source} selectiveLabel={selectiveLabel} />}
        {sideView === 'relations' && <RelationsPanel update={pair.ai} onSelect={(id) => { setSelectedVehicleId(id); setSideView('evidence') }} />}
        {sideView === 'copilot' && <CopilotPanel update={pair.ai} vehicleId={selectedVehicleId}
          onLocate={() => setSideView('evidence')} onOpenExperiment={() => openDrawer('experiment')} />}
      </aside>
    </div>

    <section className="research-drawer" aria-label="实验数据抽屉">
      <div className="drawer-heading">
        <nav>
          <button type="button" className={drawerView === 'trace' ? 'is-active' : ''} onClick={() => openDrawer('trace')}><Radio aria-hidden="true" />消息追踪</button>
          <button type="button" className={drawerView === 'compare' ? 'is-active' : ''} onClick={() => openDrawer('compare')}><GitCompareArrows aria-hidden="true" />同步对比</button>
          <button type="button" className={drawerView === 'experiment' ? 'is-active' : ''} onClick={() => openDrawer('experiment')}><SlidersHorizontal aria-hidden="true" />反事实实验</button>
          <button type="button" className={drawerView === 'notebook' ? 'is-active' : ''} onClick={() => openDrawer('notebook')}><BookOpen aria-hidden="true" />实验笔记</button>
        </nav>
        <button type="button" className="drawer-collapse" aria-label={drawerCollapsed ? '展开实验抽屉' : '折叠实验抽屉'}
          aria-expanded={!drawerCollapsed} onClick={() => setDrawerCollapsed((value) => !value)}><ChevronDown aria-hidden="true" /></button>
      </div>
      {!drawerCollapsed && <><div className="drawer-body">
        {drawerView === 'trace' && <MessageTrace pair={pair} strategy={strategy} onlyDifferences={onlyDifferences} onToggleDifferences={() => setOnlyDifferences((value) => !value)} aiLabel={selectiveLabel} />}
        {drawerView === 'compare' && <div className="comparison-board">
          <MetricCard label="通知车辆" ai={pair.ai.decision.selected_receivers.length} baseline={pair.baseline.decision.selected_receivers.length} aiLabel={selectiveLabel} />
          <MetricCard label="平均时延" ai={pair.ai.metrics.avg_delay_ms} baseline={pair.baseline.metrics.avg_delay_ms} unit=" ms" aiLabel={selectiveLabel} />
          <MetricCard label="通信负载" ai={pair.ai.metrics.comm_overhead} baseline={pair.baseline.metrics.comm_overhead} aiLabel={selectiveLabel} />
          <MetricCard label="未送达率" ai={1 - pair.ai.metrics.delivery_rate} baseline={1 - pair.baseline.metrics.delivery_rate} aiLabel={selectiveLabel} />
        </div>}
          {drawerView === 'experiment' && <ExperimentBuilder scenario={scenario} incidentVehicleId={incidentVehicleId} pair={pair} source={source} session={session} modelEligible={modelEligible} modelReason={modelReason} />}
        {drawerView === 'notebook' && <div className="notebook-panel">
          <div className="notebook-toolbar"><span>{notebook.length} 条可复现实验记录</span><button type="button" onClick={exportNotebook} disabled={notebook.length === 0}><Download aria-hidden="true" />导出 JSON</button></div>
          {notebook.length === 0 ? <p className="research-empty">点击场景上方的“保存证据”，记录当前对比结果。</p> : notebook.map((entry) => <article key={entry.id}>
            <span><strong>{entry.scenarioName}</strong><small>{new Date(entry.createdAt).toLocaleString('zh-CN')}</small></span>
            <p>{entry.hypothesis}</p><b>{entry.source === 'real' ? 'AI' : '规则'} {entry.result.aiReceivers} 辆 / 传统 {entry.result.baselineReceivers} 辆</b>
          </article>)}
        </div>}
      </div>
      <div className="research-timeline">
        <button type="button" onClick={() => session.control(session.playing ? 'pause' : 'play')} disabled={session.status !== 'connected'}>{session.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
        <Gauge aria-hidden="true" /><span>{pair.ai.timestamp.toFixed(1)} s</span>
        <input aria-label="同步实验时间轴" type="range" min="0" max={Math.max(0, pairs.length - 1)} value={Math.min(frameIndex, pairs.length - 1)} onChange={(event) => setFrameIndex(Number(event.target.value))} />
        <small>事件 → 决策 → 发包 → 送达</small>
      </div></>}
    </section>
  </section>
}
