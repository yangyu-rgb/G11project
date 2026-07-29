import { AlertTriangle, Clapperboard, Pause, Play, RotateCcw, Satellite, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import {
  PRESENTATION_DENSITIES,
  type PresentationDensity,
} from '../SceneEditor/PresetScenes'
import type { ComparisonPair, SimulationVehicle, StateUpdateMessage } from '../../types/simulation'
import type { PresentationMode, PresentationPhase, PresentationSource } from '../../hooks/usePresentationDemo'
import { evidenceForVehicle } from '../../types/research'
import {
  comparisonMetrics,
  conclusionFor,
  PRESENTATION_DURATION_MS,
  presentationCueAt,
  stageMetrics,
  STAGE_LABELS,
  type PresentationStage,
} from './presentationTimeline'

type SelectionPanelProps = {
  vehicles: SimulationVehicle[]
  selectedVehicleId: string | null
  preparing: boolean
  density: PresentationDensity
  modelEligible: boolean
  modelReason: string | null
  notice: string | null
  onDensityChange: (density: PresentationDensity) => void
  onStart: () => void
}

export function SelectionPanel({ vehicles, selectedVehicleId, preparing, density, modelEligible,
  modelReason, notice, onDensityChange, onStart }: SelectionPanelProps) {
  const selected = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  return (
    <aside className="selection-panel" aria-labelledby="selection-heading">
      <p className="hud-kicker">事故场景配置</p>
      <h2 id="selection-heading">选择交通密度</h2>
      <p>系统将事故车自动放在最适合比较的位置，同时保留真实PPO推理和完整车辆关系。</p>
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
      <div className="selected-vehicle-card" aria-live="polite">
        {selected ? <>
          <span>自动选择的事故车辆</span>
          <strong>{selected.id}</strong>
          <small>外侧车道 · 车流纵向约75%位置 · 初始速度96 km/h</small>
        </> : <span>正在确定事故车辆</span>}
      </div>
      <button type="button" className="primary-action" disabled={!selected || preparing || !modelEligible} onClick={onStart}>
        <Play aria-hidden="true" />{preparing ? '正在计算真实对比…' : '创建事故并开始演示'}
      </button>
      {!modelEligible && <div className="model-gate-warning" role="status">
        <AlertTriangle aria-hidden="true" /><span><strong>AI演示暂不可用</strong>{modelReason ?? '正在核验正式模型资格'}</span>
      </div>}
      {notice && <div className="selection-notice" role="status">{notice}</div>}
      <small className="selection-help">计算完成后进入自由证据舞台；也可一键播放38秒答辩脚本。</small>
    </aside>
  )
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
  broadcast: '传统方法通知通信域内几乎所有车辆，产生大量不必要传输。',
  ai: 'AI根据车辆位置和风险关系，只选择真正需要警报的接收者。',
  summary: '同一事故、同一时间戳下的通信结果对比。',
}

function StrategyActionReadout({ update }: { update: StateUpdateMessage | undefined }) {
  if (!update || update.decision.action_mode !== 'directional_corridor') return null
  const decision = update.decision
  const bandwidth = decision.bandwidth_fraction
    ?? decision.bandwidth_allocation.reduce((total, value) => total + value, 0)
  return <div className="strategy-action" aria-label="PPO结构动作">
    <span><small>走廊半径</small><strong>{decision.corridor_radius_m?.toFixed(0) ?? '—'} m</strong></span>
    <span><small>车道范围</small><strong>{decision.corridor_lane_scope === 'same_and_adjacent'
      ? '同车道 + 相邻' : '仅同车道'}</strong></span>
    <span><small>优先级</small><strong>{({ low: '低', medium: '中', high: '高' })[decision.priority]}</strong></span>
    <span><small>总带宽</small><strong>{(bandwidth * 100).toFixed(0)}%</strong></span>
  </div>
}

function ReceiverOutcomeSummary({ update }: { update: StateUpdateMessage | undefined }) {
  const relations = update?.decision.receiver_relations ?? []
  if (!relations.length) return null
  const selected = relations.filter((item) => item.outcome === 'selected').length
  const ahead = relations.filter((item) => item.outcome === 'ahead').length
  const excluded = relations.length - selected - ahead
  return <div className="receiver-outcome-summary" aria-label="AI逐车关系判定汇总">
    <span><strong>{selected}</strong><small>风险走廊内</small></span>
    <span><strong>{ahead}</strong><small>事故车前方</small></span>
    <span><strong>{excluded}</strong><small>过远 / 非目标车道</small></span>
  </div>
}

type RelationCallout = { id: string; label: string; detail: string; selected: boolean }

function relationCallouts(update: StateUpdateMessage | undefined): RelationCallout[] {
  if (!update) return []
  const selected = new Set(update.decision.selected_receivers)
  const weights = new Map<string, number>()
  for (const item of update.attention_weights ?? []) {
    weights.set(item.vehicle_id, Math.max(weights.get(item.vehicle_id) ?? 0, item.weight))
  }
  const candidates = update.decision.candidate_vehicles ?? []
  const chosen = candidates.filter((candidate) => selected.has(candidate.id))
    .sort((left, right) => (weights.get(right.id) ?? 0) - (weights.get(left.id) ?? 0)
      || left.distance_m - right.distance_m)
    .slice(0, 2)
    .map((candidate) => ({
      id: candidate.id,
      label: update.decision.selection_reason?.[candidate.id] ?? '风险关系优先',
      detail: `${candidate.distance_m.toFixed(0)} m · ${weights.has(candidate.id)
        ? `注意力 ${(weights.get(candidate.id) as number * 100).toFixed(0)}%` : '策略已选择'}`,
      selected: true,
    }))
  const rejected = candidates.filter((candidate) => !selected.has(candidate.id))
    .sort((left, right) => right.distance_m - left.distance_m)[0]
  return rejected ? [...chosen, {
    id: rejected.id,
    label: '未进入优先接收集合',
    detail: `${rejected.distance_m.toFixed(0)} m · 保持灰化`,
    selected: false,
  }] : chosen
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
  onTogglePause: () => void
  onReplay: () => void
  onAutoplay: () => void
  onSeek: (elapsedMs: number) => void
  onReset: () => void
}

export function DemoHud({ phase, source, stage, elapsedMs, evidence, accidentVehicleId, notice,
  mode, inspectedVehicleId, onTogglePause, onReplay, onAutoplay, onSeek, onReset }: DemoHudProps) {
  const active = stage === 'broadcast' ? evidence?.baseline : evidence?.ai
  const cue = presentationCueAt(elapsedMs)
  const metrics = stageMetrics(active, source === 'real', cue.linkRevealProgress)
  const callouts = relationCallouts(evidence?.ai)
  const visibleCallouts = stage === 'ai'
    ? callouts.slice(0, Math.max(0, Math.min(3, Math.floor((cue.stageProgress - 0.1) / 0.12) + 1))) : []
  const channel: AnimationChannel = stage === 'broadcast' ? 'comparison-baseline' : 'comparison-ai'
  const complete = phase === 'complete'
  const paused = phase === 'paused'
  const exploring = phase === 'exploring'
  const bookmarks: Array<{ stage: PresentationStage; elapsedMs: number }> = [
    { stage: 'normal', elapsedMs: 0 }, { stage: 'accident', elapsedMs: 6_400 },
    { stage: 'broadcast', elapsedMs: 14_000 }, { stage: 'ai', elapsedMs: 23_400 },
    { stage: 'summary', elapsedMs: 35_600 },
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

      {(stage === 'broadcast' || stage === 'ai') && evidence && <div className="evidence-time-badge">
        同一事故决策帧 · t={evidence.ai.timestamp.toFixed(1)} s · 车辆位置已冻结
      </div>}

      {stage !== 'summary' && <section className={`narrative-card narrative-card--${stage}`}>
        <p className="hud-kicker">{stage === 'broadcast' ? '基线方法' : stage === 'ai' ? '智能策略' : '事故场景'}</p>
        <h2>{STAGE_LABELS[stage]}</h2>
        <p>{DESCRIPTIONS[stage]}</p>
        {stage === 'accident' && <div className="accident-readout">
          <AlertTriangle aria-hidden="true" />
          <span>检测到事故<small>{accidentVehicleId}</small></span>
          <AccidentSpeed vehicleId={accidentVehicleId} channel={channel} />
        </div>}
        {(stage === 'broadcast' || stage === 'ai') && <>
          <div className="vehicle-state-legend" aria-label="车辆颜色说明">
            <span><i className="legend-swatch legend-swatch--accident" />事故车辆</span>
            <span><i className="legend-swatch legend-swatch--notified" />已接收信息</span>
            {stage === 'ai' && <span><i className="legend-swatch legend-swatch--candidate" />候选未通知</span>}
            <span><i className="legend-swatch legend-swatch--unrelated" />无关车辆</span>
          </div>
        </>}
        {stage === 'ai' && <>
          <StrategyActionReadout update={evidence?.ai} />
          <ReceiverOutcomeSummary update={evidence?.ai} />
        </>}
      </section>}

      {(stage === 'broadcast' || stage === 'ai') && <section className="metric-rail" aria-label="当前通信指标">
        <span className={`metric-rail__method metric-rail__method--${stage}`}>
          {stage === 'broadcast' ? 'BROADCAST' : 'SELECTIVE AI'}
        </span>
        {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
      </section>}

      {visibleCallouts.length > 0 && !exploring && <aside className="relation-callouts" aria-label="AI接收车辆选择解释">
        <p className="hud-kicker">关系判定</p>
        {visibleCallouts.map((item, index) => <div key={item.id}
          className={`relation-callout ${item.selected ? 'relation-callout--selected' : 'relation-callout--rejected'}`}
          style={{ '--callout-index': index } as React.CSSProperties}>
          <span>{item.selected ? '优先接收' : '未选择'}</span>
          <strong>{item.id}</strong>
          <b>{item.label}</b>
          <small>{item.detail}</small>
        </div>)}
      </aside>}

      {stage === 'summary' && <FinalComparison pair={evidence} source={source}
        visibleMetricCount={cue.summaryMetricCount} showTagline={cue.showSummaryTagline} />}

      {exploring && stage !== 'summary' && inspectedVehicleId && evidence && <VehicleEvidenceCard
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
  const relation = pair.ai.decision.receiver_relations?.find((item) => item.id === vehicleId)
  if (vehicleId === accidentVehicleId) return <aside className="vehicle-question-card" aria-label="车辆决策追问">
    <p className="hud-kicker">车辆决策追问</p>
    <div className="vehicle-question-heading"><strong>{vehicleId}</strong><span className="is-sender">事故发送源</span></div>
    <p>该车是事故警报的发送方，不属于接收者选择对象。请点击道路中的其他车辆，检查AI为什么通知或忽略它。</p>
    <small>推荐选择事故车后方同车道车辆，或传统广播通知但AI忽略的远端车辆。</small>
  </aside>
  const answer = question === 'baseline'
    ? baseline.selected
      ? `传统广播向 ${vehicleId} 发送消息，不区分它是否属于高风险接收者。`
      : `当前基线在该时刻没有向 ${vehicleId} 发包。`
    : question === 'stress'
      ? '低带宽结果需要进入“研究实验台”的压力预设或现场实跑验证，这里不生成估计指标。'
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
      <span>传统广播<b>{baseline.selected ? '仍会通知' : '未通知'}</b></span>
      <span>事件距离<b>{ai.distanceM === null && !relation ? '—'
        : `${(ai.distanceM ?? relation?.distance_m ?? 0).toFixed(1)} m`}</b></span>
    </div>
    <div className="vehicle-question-actions">
      <button type="button" className={question === 'why' ? 'is-active' : ''} onClick={() => setQuestion('why')}>为什么？</button>
      <button type="button" className={question === 'baseline' ? 'is-active' : ''} onClick={() => setQuestion('baseline')}>传统方法呢？</button>
      <button type="button" className={question === 'stress' ? 'is-active' : ''} onClick={() => setQuestion('stress')}>低带宽会怎样？</button>
    </div>
    <p>{answer}</p>
    <small>观测事实与解释线索分开展示；注意力不代表严格因果关系。</small>
  </aside>
}

function ComparisonFootprints({ pair }: { pair: ComparisonPair }) {
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
    { key: 'broadcast', title: '传统全量广播', update: pair.baseline, color: '#f0a84b' },
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

function FinalComparison({ pair, source, visibleMetricCount, showTagline }: {
  pair: ComparisonPair | null
  source: PresentationSource
  visibleMetricCount: number
  showTagline: boolean
}) {
  const metrics = comparisonMetrics(pair, source === 'real')
  return (
    <section className="final-comparison" aria-labelledby="comparison-heading">
      <div className="final-heading">
        <p className="hud-kicker">同一事故 · 同一时间戳</p>
        <h2 id="comparison-heading">通信策略对比结果</h2>
      </div>
      {pair && <ComparisonFootprints pair={pair} />}
      <div className="comparison-method-headings" aria-hidden="true">
        <span><Satellite />传统全量广播</span><span><ShieldCheck />AI选择性广播</span>
      </div>
      <div className="comparison-table" role="table" aria-label="传统广播与AI选择性广播指标对比">
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
        更少通知 · 更精准 · 更低负载 · 更优时延
      </strong>
    </section>
  )
}
