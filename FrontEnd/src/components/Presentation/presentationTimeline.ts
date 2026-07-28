import type {
  ComparisonPair,
  StateUpdateMessage,
} from '../../types/simulation'

export const PRESENTATION_DURATION_MS = 38_000

export type PresentationStage = 'normal' | 'accident' | 'broadcast' | 'ai' | 'summary'

export type CameraShot = {
  offset: readonly [number, number, number]
  fov: number
  lookAhead: number
}

export type PresentationCue = {
  stage: PresentationStage
  stageProgress: number
  linkRevealProgress: number
  riskProgress: number
  summaryMetricCount: number
  showSummaryTagline: boolean
  camera: CameraShot
}

export type ComparisonMetric = {
  label: string
  baseline: string
  ai: string
  delta?: string
}

export function stageAt(elapsedMs: number): PresentationStage {
  if (elapsedMs < 5_000) return 'normal'
  if (elapsedMs < 11_000) return 'accident'
  if (elapsedMs < 20_000) return 'broadcast'
  if (elapsedMs < 30_000) return 'ai'
  return 'summary'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function easedProgress(elapsedMs: number, startMs: number, durationMs: number): number {
  const progress = clamp01((elapsedMs - startMs) / durationMs)
  return progress * progress * (3 - 2 * progress)
}

export function cameraShotAt(elapsedMs: number): CameraShot {
  if (elapsedMs < 4_300) return { offset: [-7.4, 3.25, 5.6], fov: 39, lookAhead: 1.65 }
  if (elapsedMs < 7_900) return { offset: [-3.05, 1.72, 3.45], fov: 36, lookAhead: 0.45 }
  if (elapsedMs < 11_000) return { offset: [-4.15, 2.55, 4.8], fov: 38, lookAhead: 0.7 }
  if (elapsedMs < 30_000) return { offset: [-3.25, 6.35, 8.9], fov: 42, lookAhead: 0.2 }
  return { offset: [-5.7, 7.2, 10.8], fov: 43, lookAhead: 0.8 }
}

export function presentationCueAt(elapsedMs: number): PresentationCue {
  const elapsed = Math.max(0, Math.min(PRESENTATION_DURATION_MS, elapsedMs))
  const stage = stageAt(elapsed)
  const stageBounds: Record<PresentationStage, readonly [number, number]> = {
    normal: [0, 5_000], accident: [5_000, 11_000], broadcast: [11_000, 20_000],
    ai: [20_000, 30_000], summary: [30_000, PRESENTATION_DURATION_MS],
  }
  const [start, end] = stageBounds[stage]
  const linkRevealProgress = stage === 'broadcast'
    ? easedProgress(elapsed, 11_450, 2_350)
    : stage === 'ai' ? easedProgress(elapsed, 20_650, 2_250) : 0
  return {
    stage,
    stageProgress: clamp01((elapsed - start) / (end - start)),
    linkRevealProgress,
    riskProgress: stage === 'accident' ? easedProgress(elapsed, 5_250, 1_050) : 0,
    summaryMetricCount: stage === 'summary'
      ? Math.max(0, Math.min(4, Math.floor((elapsed - 30_450) / 720) + 1)) : 0,
    showSummaryTagline: elapsed >= 35_300,
    camera: cameraShotAt(elapsed),
  }
}

export const STAGE_LABELS: Record<PresentationStage, string> = {
  normal: '正常车流',
  accident: '事故发生',
  broadcast: '传统全量广播',
  ai: 'AI选择性广播',
  summary: '结果对比',
}

export function findIncidentPair(history: readonly ComparisonPair[]): ComparisonPair | null {
  return history.find((pair) => pair.ai.events.length > 0 && pair.baseline.events.length > 0)
    ?? history.find((pair) => pair.ai.messages.length > 0 || pair.baseline.messages.length > 0)
    ?? history[0]
    ?? null
}

function percentChange(baseline: number, ai: number, inverse = false): string {
  if (baseline === 0) return '不适用'
  const raw = ((ai - baseline) / baseline) * 100
  const value = inverse ? -raw : raw
  if (Math.abs(value) < 0.05) return '持平'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function notified(update: StateUpdateMessage): number {
  return new Set(update.decision.selected_receivers).size
}

function metricValue(value: number, suffix = ''): string {
  return `${value.toFixed(1)}${suffix}`
}

export function comparisonMetrics(pair: ComparisonPair | null, networkMetricsAvailable = true): ComparisonMetric[] {
  if (!pair) {
    return [
      { label: '通知车辆数', baseline: '未计算', ai: '未计算' },
      { label: '相关接收占比', baseline: '未计算', ai: '未计算' },
      { label: '通信负载', baseline: '未计算', ai: '未计算' },
      { label: '平均时延', baseline: '未计算', ai: '未计算' },
    ]
  }
  const baselineCount = pair.baseline.messages.length
  const aiCount = pair.ai.messages.length
  const baselinePrecision = selectionPrecision(pair.baseline)
  const aiPrecision = selectionPrecision(pair.ai)
  return [
    {
      label: '通知车辆数',
      baseline: String(notified(pair.baseline)),
      ai: String(notified(pair.ai)),
      delta: `${Math.max(0, notified(pair.baseline) - notified(pair.ai))} 辆更少`,
    },
    {
      label: '相关接收占比',
      baseline: baselinePrecision === null ? '不适用' : `${baselinePrecision.toFixed(1)}%`,
      ai: aiPrecision === null ? '不适用' : `${aiPrecision.toFixed(1)}%`,
      delta: baselinePrecision !== null && aiPrecision !== null
        ? `${aiPrecision >= baselinePrecision ? '+' : ''}${(aiPrecision - baselinePrecision).toFixed(1)} 个百分点`
        : undefined,
    },
    {
      label: '通信负载',
      baseline: `${baselineCount} 次发送`,
      ai: `${aiCount} 次发送`,
      delta: percentChange(baselineCount, aiCount, true),
    },
    {
      label: '平均时延',
      baseline: networkMetricsAvailable ? metricValue(pair.baseline.metrics.avg_delay_ms, ' ms') : '未计算',
      ai: networkMetricsAvailable ? metricValue(pair.ai.metrics.avg_delay_ms, ' ms') : '未计算',
      delta: networkMetricsAvailable
        ? percentChange(pair.baseline.metrics.avg_delay_ms, pair.ai.metrics.avg_delay_ms, true) : undefined,
    },
  ]
}

export function selectionPrecision(update: StateUpdateMessage): number | null {
  const selected = new Set(update.decision.selected_receivers)
  if (selected.size === 0) return null
  const candidates = new Set(update.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? [])
  const relevantSelected = [...selected].filter((vehicleId) => candidates.has(vehicleId)).length
  return relevantSelected / selected.size * 100
}

export function stageMetrics(
  update: StateUpdateMessage | undefined,
  networkMetricsAvailable: boolean,
  revealProgress = 1,
): Array<{ label: string; value: string }> {
  const progress = clamp01(revealProgress)
  const notifiedVehicles = update
    ? Math.ceil(new Set(update.decision.selected_receivers).size * progress) : 0
  const precision = update ? selectionPrecision(update) : null
  return [
    { label: '通知车辆', value: String(notifiedVehicles) },
    { label: '相关接收占比', value: progress < 0.35 || precision === null ? '—' : `${precision.toFixed(1)}%` },
    { label: '通信负载', value: update ? `${Math.ceil(update.messages.length * progress)} 次` : '0 次' },
    { label: '平均时延', value: update && networkMetricsAvailable && progress >= 0.55
      ? `${update.metrics.avg_delay_ms.toFixed(1)} ms` : '未计算' },
  ]
}

export function conclusionFor(pair: ComparisonPair | null, networkMetricsAvailable = true): string {
  if (!pair || !networkMetricsAvailable) return '当前为规则演示，时延和送达率需要真实模型运行后确认。'
  const fewer = notified(pair.ai) < notified(pair.baseline)
  const faster = pair.ai.metrics.avg_delay_ms < pair.baseline.metrics.avg_delay_ms
  if (fewer && faster) return '本场景中，AI选择性V2X减少了不必要广播，并降低了估算通信时延。'
  if (fewer) return '本场景中，AI减少了不必要广播；时延收益请以对比数据为准。'
  return '本场景展示了AI与全量广播的接收者选择差异，具体收益以实测指标为准。'
}
