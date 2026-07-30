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
  const priority = { low: '低', medium: '中', high: '高' }[data.priority] ?? data.priority.toUpperCase()
  const bandwidthPercent = Math.round(data.bandwidthFraction * 100)
  return <section className={`telemetry-method telemetry-method--${tone}`}
    aria-label={`${label}当前帧网络指标`}>
    <header><span>{tone === 'ai' ? <Network aria-hidden="true" /> : <RadioTower aria-hidden="true" />}
      <strong>{label}</strong></span><time>LIVE REPLAY</time></header>
    <div><span><small>累计通知车辆</small><b>{data.selectedCount}</b></span>
      <span><small>累计发送</small><b>{data.sentCount}</b></span>
      <span><small>平均时延</small><b>{data.avgDelayMs.toFixed(1)}<em>ms</em></b></span>
      <span><small>发送/成功比</small><b>{data.commOverhead.toFixed(2)}</b></span></div>
    <section className="telemetry-resource"
      aria-label={`${label}当前决策资源：${priority}优先级，${bandwidthPercent}%总带宽`}>
      <span><small>当前资源决策</small><b>{priority}优先级 · {bandwidthPercent}%总带宽</b></span>
      <i aria-hidden="true"><em style={{ transform: `scaleX(${data.bandwidthFraction})` }} /></i>
    </section>
    <footer><span className="is-success">成功 {data.successCount}</span>
      <span className={data.timeoutCount ? 'is-timeout' : ''}>超时 {data.timeoutCount}</span>
      <span>送达率 {(data.deliveryRate * 100).toFixed(1)}%</span></footer>
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
  const laneScope = telemetry.action.laneScope === 'same_and_adjacent' ? '同车道 + 相邻' : '仅同车道'
  const resourceNote = baseline === 'urgency'
    ? '同一300 m接收集合 · 严重度调度资源'
    : baseline === 'distance'
      ? '300 m接收集合 · 固定资源配置'
      : '全通信域接收集合 · 固定资源配置'
  return <div className="live-telemetry-hud" aria-label="当前回放帧实时遥测">
    <section className="telemetry-process" aria-label="事故动力学与AI筛选过程">
      <div className="telemetry-speed">
        <header><Activity aria-hidden="true" /><span><small>事故车速度</small>
          <strong>{telemetry.accidentSpeedKmh.toFixed(0)} <em>km/h</em></strong></span>
          <b>-{telemetry.decelerationMps2.toFixed(1)} m/s²</b></header>
        <svg viewBox="0 0 168 54" role="img" aria-label="事故车辆速度随当前回放进度变化曲线">
          <line x1="0" x2="168" y1="50" y2="50" />
          <polyline points={sparklinePoints(telemetry.speedTrace)} />
        </svg>
      </div>
      <div className="telemetry-funnel">
        <p><small>AI接收者筛选漏斗</small><time>决策帧 t={telemetry.simulationTimestamp.toFixed(1)} s · 回放 {(telemetry.replayProgress * 100).toFixed(0)}%</time></p>
        <div>
          <span><b>{funnel.evaluated}</b><small>可评估车辆</small></span><i />
          <span><b>{funnel.behindSameDirection}</b><small>后方同向</small></span><i />
          <span><b>{funnel.laneRelevant}</b><small>车道相关</small></span><i />
          <span className="is-selected"><b>{funnel.selected}</b><small>最终通知</small></span>
        </div>
        <footer><span><Gauge aria-hidden="true" />PPO动作</span>
          <b>{telemetry.action.corridorRadiusM?.toFixed(0) ?? '—'} m</b>
          <b>{laneScope}</b><b>{telemetry.action.priority.toUpperCase()}</b>
          <b>{(telemetry.action.bandwidthFraction * 100).toFixed(0)}% 带宽</b></footer>
      </div>
    </section>

    <MethodReadout data={telemetry.baseline} label={method.label} tone="baseline" />
    <MethodReadout data={telemetry.ai} label="Transformer + PPO" tone="ai" />
    <section className="telemetry-delta" aria-label="AI相对所选基线的当前帧变化">
      <span><b>{telemetry.delta.fewerVehicles}</b><small>少通知车辆</small></span>
      <span><b>{deltaText(telemetry.delta.loadReductionPercent)}</b><small>负载改善</small></span>
      <span><b>{deltaText(telemetry.delta.delayReductionPercent)}</b><small>时延改善</small></span>
      <span><b>{telemetry.delta.deliveryGainPoints >= 0 ? '+' : ''}{telemetry.delta.deliveryGainPoints.toFixed(1)}pp</b><small>送达率变化</small></span>
    </section>
    <p className="telemetry-resource-note">基线定义：{resourceNote}；资源条来自当前同步决策帧。</p>
  </div>
}
