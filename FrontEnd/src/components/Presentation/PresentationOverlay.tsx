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
  PRESENTATION_ENVIRONMENT_ORDER,
  PRESENTATION_ENVIRONMENTS,
  presentationEnvironmentDefinition,
  type PresentationEnvironment,
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
  modelEligible: boolean
  modelReason: string | null
  modelHash: string | null
  notice: string | null
  baseline: ComparisonBaseline
  onDensityChange: (density: PresentationDensity) => void
  onEnvironmentChange: (environment: PresentationEnvironment) => void
  onVehicleSelect: (vehicleId: string) => void
  onBaselineChange: (baseline: ComparisonBaseline) => void
  onStart: () => void
}

const HIGHWAY_LANE_LABELS = ['外侧车道', '中间车道', '内侧车道'] as const

function vehicleOptionLabel(vehicle: SimulationVehicle): string {
  const lane = HIGHWAY_LANE_LABELS[nearestHighwayLaneIndex(vehicle.y)]
  return `${vehicle.id} · ${lane} · ${vehicle.x.toFixed(0)} m`
}

export function SelectionPanel({ vehicles, selectedVehicleId, recommendedVehicleId, preparing,
  density, environmentPreset, modelEligible, modelReason, modelHash, notice, baseline,
  onDensityChange, onEnvironmentChange, onVehicleSelect, onBaselineChange, onStart }: SelectionPanelProps) {
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
      <div><p className="hud-kicker">答辩演示配置</p>
        <h2 id="selection-heading">创建可复现的同步算法对照</h2>
        <p>先锁定场景、事故源和对照方法，再运行同一随机种子下的真实PPO与确定性基线。</p></div>
      <span><b>38 s</b><small>四阶段演示</small></span>
    </header>

    <div className="demo-setup-grid">
      <section className="setup-section setup-section--scenario">
        <header><span>01</span><div><strong>事故场景</strong><small>控制交通规模与事故位置</small></div></header>
        <fieldset className="environment-selector" disabled={preparing}
          aria-describedby="environment-selector-help">
          <legend>道路视觉环境</legend>
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
          仅改变三维材料、光影与路侧环境；车辆轨迹、事故参数、网络输入与PPO决策保持不变。
        </p>
        <fieldset className="density-selector" disabled={preparing}>
          <legend>交通密度</legend>
          {(Object.entries(PRESENTATION_DENSITIES) as Array<[
            PresentationDensity, (typeof PRESENTATION_DENSITIES)[PresentationDensity]
          ]>).map(([value, setting]) => <button type="button" key={value}
            className={density === value ? 'is-active' : ''}
            onClick={() => onDensityChange(value)}>
            <strong>{setting.label}</strong><small>{setting.description}</small>
          </button>)}
        </fieldset>
        <div className="setup-road-map" aria-label="三车道车辆位置预览">
          {lanes.map((lane, laneIndex) => <div key={lane}>
            <span>{HIGHWAY_LANE_LABELS[laneIndex] ?? `车道${laneIndex + 1}`}</span>
            <i />
          </div>)}
          {vehicles.map((vehicle) => <button type="button" key={vehicle.id}
            className={vehicle.id === selectedVehicleId ? 'is-selected' : ''}
            aria-label={`选择 ${vehicleOptionLabel(vehicle)} 作为事故车辆`}
            aria-pressed={vehicle.id === selectedVehicleId} disabled={preparing}
            title={vehicleOptionLabel(vehicle)} onClick={() => onVehicleSelect(vehicle.id)} style={{
              '--vehicle-x': `${3 + (vehicle.x - minX) / spanX * 94}%`,
              '--vehicle-lane': lanes.indexOf(vehicle.y),
            } as React.CSSProperties}><i aria-hidden="true" /></button>)}
        </div>
        <label htmlFor="incident-vehicle-select">精确选择事故车辆</label>
        <select id="incident-vehicle-select" value={selectedVehicleId ?? ''} disabled={preparing}
          onChange={(event) => onVehicleSelect(event.target.value)}>
          {!selectedVehicleId && <option value="" disabled>请选择车辆</option>}
          {orderedVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>
            {vehicleOptionLabel(vehicle)}
          </option>)}
        </select>
        <div className="selected-vehicle-card" aria-live="polite">
          {selected ? <><span>当前事故车辆 <em>{recommended ? '系统推荐位置' : '自定义事故位置'}</em></span>
            <strong>{selected.id}</strong><small>{selectedLane} · 路段纵向约{selectedPosition}% · 初始速度{selectedSpeed?.toFixed(0)} km/h</small></>
            : <span>请选择事故车辆</span>}
        </div>
      </section>

      <section className="setup-section setup-section--methods">
        <header><span>02</span><div><strong>算法组合</strong><small>AI固定为验收模型，选择左侧对照基线</small></div></header>
        <article className={`locked-model-card ${modelEligible ? 'is-eligible' : ''}`}>
          <Cpu aria-hidden="true" /><div><small>LEARNED POLICY · LOCKED</small>
            <strong>Transformer + PPO V2</strong><p>方向风险走廊结构动作 · 正式答辩模型</p>
            <code>{modelHash ? `SHA ${modelHash.slice(0, 12)}…` : '正在核验模型清单'}</code></div>
          <span>{modelEligible ? <><CheckCircle2 />资格通过</> : <><AlertTriangle />不可用</>}</span>
        </article>
        <fieldset className="baseline-selector" disabled={preparing}>
          <legend>选择确定性基线</legend>
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
          <AlertTriangle aria-hidden="true" /><span><strong>AI演示暂不可用</strong>{modelReason ?? '正在核验正式模型资格'}</span>
        </div>}
      </section>
    </div>

    <footer className="demo-setup-footer">
      <div><span><small>场景</small><b>{presentationEnvironmentDefinition(environmentPreset).shortLabel} · {vehicles.length}辆</b></span>
        <span><small>制动</small><b>96 → 18 km/h</b></span>
        <span><small>事故源</small><b>{selected?.id ?? '未选择'}</b></span>
        <span><small>同步对照</small><b>{selectedMethod.label} vs AI</b></span></div>
      {notice && <p className="selection-notice" role="status">{notice}</p>}
      <button type="button" className="primary-action" disabled={!selected || preparing || !modelEligible} onClick={onStart}>
        <Play aria-hidden="true" />{preparing ? '正在计算真实对比…' : '确认配置并生成演示'}
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
  normal: '车辆在三车道高速公路上保持正常行驶。',
  accident: '目标车辆突然急刹，车联网系统立即生成安全警报。',
  comparison: '两种算法在完全相同的事故状态与时间戳下同步运行。',
  summary: '同一事故、同一时间戳下的通信结果对比。',
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
  onTogglePause: () => void
  onReplay: () => void
  onAutoplay: () => void
  onSeek: (elapsedMs: number) => void
  onReset: () => void
  onOpenValidation: () => void
}

export function DemoHud({ phase, source, stage, elapsedMs, evidence, accidentVehicleId, notice,
  mode, inspectedVehicleId, results, comparisonMode, telemetry, baseline, environmentPreset,
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
      <div className="stage-strip" aria-label="演示进度">
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
        <AlertTriangle aria-hidden="true" />规则演示 · 非PPO输出
      </div>}
      {notice && elapsedMs < 5_000
        && <p className="presentation-notice" aria-live="polite">{notice}</p>}

      {stage === 'comparison' && telemetry && <div className="evidence-time-badge">
        {environment.shortLabel} · 同一真实决策帧 · 双路同步回放 · 10 Hz累计遥测
      </div>}

      {!comparisonMode && stage !== 'summary' && <section className={`narrative-card narrative-card--${stage}`}>
        <p className="hud-kicker">事故场景 · {environment.label}</p>
        <h2>{STAGE_LABELS[stage]}</h2>
        <p>{DESCRIPTIONS[stage]}</p>
        {stage === 'accident' && <div className="accident-readout">
          <AlertTriangle aria-hidden="true" />
          <span>检测到事故<small>{accidentVehicleId}</small></span>
          <AccidentSpeed vehicleId={accidentVehicleId} channel={channel} />
        </div>}
      </section>}

      {stage === 'comparison' && telemetry && <LiveTelemetryHud telemetry={telemetry} baseline={baseline} />}
      {stage === 'comparison' && !telemetry && <div className="telemetry-loading" role="status">正在同步两路当前帧遥测…</div>}

      {stage === 'summary' && <FinalComparison pair={evidence} source={source} results={results}
        baseline={baseline} visibleMetricCount={cue.summaryMetricCount} showTagline={cue.showSummaryTagline}
        environmentLabel={environment.label} onOpenValidation={onOpenValidation} />}

      {exploring && stage === 'comparison' && inspectedVehicleId
        && inspectedVehicleId !== accidentVehicleId && evidence && <VehicleEvidenceCard
        pair={evidence} vehicleId={inspectedVehicleId} accidentVehicleId={accidentVehicleId} />}

      <div className="playback-controls" aria-label="演示播放控制">
        {!complete && <button type="button" onClick={onTogglePause}>
          {paused || exploring ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused || exploring ? '播放' : '暂停'}
        </button>}
        <button type="button" className={mode === 'autoplay' ? 'is-active' : ''} onClick={onAutoplay}>
          <Clapperboard aria-hidden="true" />一键答辩回放
        </button>
        <button type="button" onClick={onReplay}><RotateCcw aria-hidden="true" />重新播放</button>
        <button type="button" onClick={onReset}>重新配置</button>
        <input type="range" aria-label="演示时间轴" min="0" max={PRESENTATION_DURATION_MS}
          step="100" value={elapsedMs} onChange={(event) => onSeek(Number(event.target.value))} />
        <time>{Math.min(38, elapsedMs / 1000).toFixed(1)} / 38.0 秒</time>
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
  if (vehicleId === accidentVehicleId) return <aside className="vehicle-question-card" aria-label="车辆决策追问">
    <p className="hud-kicker">车辆决策追问</p>
    <div className="vehicle-question-heading"><strong>{vehicleId}</strong><span className="is-sender">事故发送源</span></div>
    <p>该车是事故警报的发送方，不属于接收者选择对象。请点击道路中的其他车辆，检查AI为什么通知或忽略它。</p>
    <small>推荐选择事故车后方同车道车辆，或传统广播通知但AI忽略的远端车辆。</small>
  </aside>
  const answer = question === 'baseline'
    ? baseline.selected
      ? `${method.label}向 ${vehicleId} 发送了消息；可与AI的关系判定逐车核对。`
      : `当前基线在该时刻没有向 ${vehicleId} 发包。`
    : question === 'stress'
      ? '低带宽结果需要进入“验证实验室”的网络压力预设并现场实跑，这里不生成估计指标。'
      : ai.selected
        ? `${vehicleId} 已进入候选集合并被策略选中。记录理由：${ai.reason}。`
        : ai.candidate
          ? `${vehicleId} 在候选范围内，但没有进入最终接收集合。候选范围不等于最终动作。`
          : relation?.outcome === 'ahead'
            ? `${vehicleId} 位于事故车前方，不属于追尾风险传播方向，因此AI没有通知它。`
            : relation?.outcome === 'outside_lane_scope'
              ? `${vehicleId} 不在本次策略选择的同车道或相邻车道范围内，因此保持灰化。`
              : relation?.outcome === 'outside_corridor'
                ? `${vehicleId} 虽位于事故车后方，但超出本次PPO选择的风险走廊，因此不需要接收警报。`
                : `${vehicleId} 未进入当前事件候选集合，因此AI没有向它发送警报。`
  return <aside className="vehicle-question-card" aria-label="车辆决策追问">
    <p className="hud-kicker">车辆决策追问</p>
    <div className="vehicle-question-heading"><strong>{vehicleId}</strong>
      <span className={ai.selected ? 'is-selected' : ''}>{ai.selected ? 'AI已通知' : 'AI未通知'}</span></div>
    <div className="vehicle-fact-row">
      <span>候选状态<b>{ai.candidate ? '候选集合内' : '范围外'}</b></span>
      <span>{method.label}<b>{baseline.selected ? '会通知' : '未通知'}</b></span>
      <span>事件距离<b>{ai.distanceM === null && !relation ? '—'
        : `${(ai.distanceM ?? relation?.distance_m ?? 0).toFixed(1)} m`}</b></span>
    </div>
    <div className="vehicle-question-actions">
      <button type="button" className={question === 'why' ? 'is-active' : ''} onClick={() => setQuestion('why')}>为什么？</button>
      <button type="button" className={question === 'baseline' ? 'is-active' : ''} onClick={() => setQuestion('baseline')}>所选基线呢？</button>
      <button type="button" className={question === 'stress' ? 'is-active' : ''} onClick={() => setQuestion('stress')}>低带宽会怎样？</button>
    </div>
    <p>{answer}</p>
    <small>观测事实与解释线索分开展示；注意力不代表严格因果关系。</small>
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
    { key: 'ai', title: 'AI选择性广播', update: pair.ai, color: '#2dd4a3' },
  ] as const
  return <div className="comparison-footprints" aria-label="同尺度通信覆盖俯视图">
    {panels.map((panel) => {
      const selected = new Set(panel.update.decision.selected_receivers)
      return <figure key={panel.key}>
        <figcaption><strong>{panel.title}</strong><span>{selected.size} 辆接收</span></figcaption>
        <svg viewBox="0 0 440 92" role="img"
          aria-label={`${panel.title}在三车道同尺度路段中的接收车辆分布`}>
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
  { key: 'affected_vehicle_coverage', label: '受影响车辆覆盖率', unit: '%', scale: 100 },
  { key: 'communication_overhead', label: '消息冗余', unit: '', scale: 1 },
  { key: 'normalized_channel_cost', label: '归一化信道成本', unit: '', scale: 1 },
  { key: 'p95_latency_ms', label: 'P95 时延', unit: ' ms', scale: 1 },
] as const

const METHOD_NAMES: Record<string, string> = {
  ai: 'Transformer + PPO', broadcast: '全量广播', distance: '固定范围', urgency: '紧急度调度',
}

function HeldoutMethodTable({ results }: { results: DemoResultsSummary | null }) {
  if (!results?.ready) return <div className="heldout-pending">
    <strong>留出集结果正在等待训练流水线</strong><span>{results?.reason ?? '完成后自动显示四方法统一口径结果'}</span>
  </div>
  return <section className="all-method-results" aria-labelledby="heldout-heading">
    <header><div><small>HELD-OUT EVALUATION</small><strong id="heldout-heading">四种方法统一留出集</strong></div>
      <span>{results.case_count ?? '—'} cases · protocol {results.protocol}</span></header>
    <div role="table" aria-label="四种方法留出集指标对比">
      <div className="all-method-results__head" role="row"><b role="columnheader">方法</b>
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
    <p className="heldout-method-note">固定范围与紧急度采用同一300 m接收集合；后者的差异体现在严重度驱动的优先级、带宽与信道成本。</p>
  </section>
}

function resultTagline(pair: ComparisonPair | null): string {
  if (!pair) return '以同场景实测数据为准'
  const baselineCount = new Set(pair.baseline.decision.selected_receivers).size
  const aiCount = new Set(pair.ai.decision.selected_receivers).size
  const claims = [aiCount < baselineCount ? '更少通知' : '接收规模相当']
  claims.push(aiCount < baselineCount ? '更低负载' : '负载收益有限')
  claims.push(pair.ai.metrics.avg_delay_ms < pair.baseline.metrics.avg_delay_ms ? '更优时延' : '时延未占优')
  return `${claims.join(' · ')} · 结果不作美化`
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
        <p className="hud-kicker">{environmentLabel} · 同一事故 · 同一时间戳</p>
        <h2 id="comparison-heading">通信策略对比结果</h2>
      </div>
      <div className="final-comparison__body">
        <section className="case-comparison">
          {pair && <ComparisonFootprints pair={pair} baseline={baseline} />}
          <div className="comparison-method-headings" aria-hidden="true">
            <span><Satellite />{method.label}</span><span><ShieldCheck />AI选择性广播</span>
          </div>
          <div className="comparison-table" role="table" aria-label={`${method.label}与AI选择性广播指标对比`}>
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
            onClick={onOpenValidation}><FlaskConical aria-hidden="true" />深入验证本次结果</button>
        </section>
        <HeldoutMethodTable results={results} />
      </div>
    </section>
  )
}
