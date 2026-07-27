import { AlertTriangle, Pause, Play, RotateCcw, Satellite, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { ComparisonPair, SimulationVehicle } from '../../types/simulation'
import type { PresentationPhase, PresentationSource } from '../../hooks/usePresentationDemo'
import {
  comparisonMetrics,
  conclusionFor,
  PRESENTATION_DURATION_MS,
  stageMetrics,
  STAGE_LABELS,
  type PresentationStage,
} from './presentationTimeline'

type SelectionPanelProps = {
  vehicles: SimulationVehicle[]
  selectedVehicleId: string | null
  preparing: boolean
  onSelect: (vehicleId: string) => void
  onStart: () => void
}

export function SelectionPanel({ vehicles, selectedVehicleId, preparing, onSelect, onStart }: SelectionPanelProps) {
  const selected = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)
  return (
    <aside className="selection-panel" aria-labelledby="selection-heading">
      <p className="hud-kicker">事故场景配置</p>
      <h2 id="selection-heading">选择一辆事故车</h2>
      <p>直接点击道路中的车辆，或使用下方列表。系统将对同一事故分别运行AI策略和传统全量广播。</p>
      <label htmlFor="incident-vehicle">事故车辆</label>
      <select id="incident-vehicle" value={selectedVehicleId ?? ''}
        onChange={(event) => onSelect(event.target.value)}>
        <option value="" disabled>请选择车辆</option>
        {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.id}</option>)}
      </select>
      <div className="selected-vehicle-card" aria-live="polite">
        {selected ? <>
          <span>已选车辆</span>
          <strong>{selected.id}</strong>
          <small>车道 {Math.round((selected.y + 8) / 3.2) + 1} · 初始速度 96 km/h</small>
        </> : <span>尚未选择事故车辆</span>}
      </div>
      <button type="button" className="primary-action" disabled={!selected || preparing} onClick={onStart}>
        <Play aria-hidden="true" />{preparing ? '正在计算真实对比…' : '创建事故并开始演示'}
      </button>
      <small className="selection-help">演示开始后自动播放38秒；可随时暂停或重新选择。</small>
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

type DemoHudProps = {
  phase: PresentationPhase
  source: PresentationSource
  stage: PresentationStage
  elapsedMs: number
  evidence: ComparisonPair | null
  accidentVehicleId: string
  notice: string | null
  onTogglePause: () => void
  onReplay: () => void
  onReset: () => void
}

export function DemoHud({ phase, source, stage, elapsedMs, evidence, accidentVehicleId, notice,
  onTogglePause, onReplay, onReset }: DemoHudProps) {
  const active = stage === 'broadcast' ? evidence?.baseline : evidence?.ai
  const metrics = stageMetrics(source === 'real' ? active?.metrics : undefined,
    active?.decision.selected_receivers.length ?? 0)
  const channel: AnimationChannel = stage === 'broadcast' ? 'comparison-baseline' : 'comparison-ai'
  const complete = phase === 'complete'
  const paused = phase === 'paused'
  return (
    <div className="presentation-hud">
      <div className="stage-strip" aria-label="演示进度">
        {(Object.keys(STAGE_LABELS) as PresentationStage[]).map((value, index) => (
          <div key={value} className={`stage-step ${value === stage ? 'stage-step--active' : ''}`}>
            <span>{index + 1}</span><b>{STAGE_LABELS[value]}</b>
          </div>
        ))}
        <div className="timeline-progress" style={{ '--progress': `${Math.min(100, elapsedMs / PRESENTATION_DURATION_MS * 100)}%` } as React.CSSProperties} />
      </div>

      {source === 'rule' && <div className="degraded-badge" role="status">
        <AlertTriangle aria-hidden="true" />规则演示 · 非PPO输出
      </div>}
      {notice && (source === 'rule' || elapsedMs < 5_000)
        && <p className="presentation-notice" aria-live="polite">{notice}</p>}

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
          <div className="stage-metrics">
            {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
            <div><span>通信方式</span><strong>{stage === 'broadcast' ? '全量广播' : '选择性通信'}</strong></div>
          </div>
        </>}
      </section>}

      {stage === 'summary' && <FinalComparison pair={evidence} source={source} />}

      <div className="playback-controls" aria-label="演示播放控制">
        {!complete && <button type="button" onClick={onTogglePause}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{paused ? '继续' : '暂停'}
        </button>}
        <button type="button" onClick={onReplay}><RotateCcw aria-hidden="true" />重新播放</button>
        <button type="button" onClick={onReset}>重新选车</button>
        <time>{Math.min(38, elapsedMs / 1000).toFixed(1)} / 38.0 秒</time>
      </div>
    </div>
  )
}

function FinalComparison({ pair, source }: { pair: ComparisonPair | null; source: PresentationSource }) {
  const metrics = comparisonMetrics(pair, source === 'real')
  return (
    <section className="final-comparison" aria-labelledby="comparison-heading">
      <div className="final-heading">
        <p className="hud-kicker">同一事故 · 同一时间戳</p>
        <h2 id="comparison-heading">通信策略对比结果</h2>
      </div>
      <div className="comparison-method-headings" aria-hidden="true">
        <span><Satellite />传统全量广播</span><span><ShieldCheck />AI选择性广播</span>
      </div>
      <div className="comparison-table" role="table" aria-label="传统广播与AI选择性广播指标对比">
        {metrics.map((metric) => <div className="comparison-row" role="row" key={metric.label}>
          <strong role="rowheader">{metric.label}</strong>
          <span role="cell">{metric.baseline}</span>
          <span role="cell">{metric.ai}</span>
          <em>{metric.delta ?? '—'}</em>
        </div>)}
      </div>
      <p className="final-conclusion">{conclusionFor(pair, source === 'real')}</p>
      <strong className="final-tagline">更精准 · 更低开销 · 更快响应</strong>
    </section>
  )
}
