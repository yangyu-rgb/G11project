import type {
  ComparisonPair,
  StateUpdateMessage,
} from '../../types/simulation'

export const PRESENTATION_DURATION_MS = 38_000

export type PresentationStage = 'normal' | 'accident' | 'comparison' | 'summary'

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
  if (elapsedMs < 30_000) return 'comparison'
  return 'summary'
}

export function comparisonModeAt(stage: PresentationStage, override: boolean | null): boolean {
  return override ?? (stage === 'comparison' || stage === 'summary')
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
    normal: [0, 5_000], accident: [5_000, 11_000], comparison: [11_000, 30_000],
    summary: [30_000, PRESENTATION_DURATION_MS],
  }
  const [start, end] = stageBounds[stage]
  const linkRevealProgress = stage === 'comparison'
    ? easedProgress(elapsed, 11_450, 2_350) : stage === 'summary' ? 1 : 0
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
  normal: 'Normal Traffic',
  accident: 'Incident Onset',
  comparison: 'Synchronized Comparison',
  summary: 'Result Comparison',
}

export function findIncidentPair(history: readonly ComparisonPair[]): ComparisonPair | null {
  return history.find((pair) => pair.ai.events.length > 0 && pair.baseline.events.length > 0)
    ?? history.find((pair) => pair.ai.messages.length > 0 || pair.baseline.messages.length > 0)
    ?? history[0]
    ?? null
}

function percentChange(baseline: number, ai: number, inverse = false): string {
  if (baseline === 0) return 'N/A'
  const raw = ((ai - baseline) / baseline) * 100
  const value = inverse ? -raw : raw
  if (Math.abs(value) < 0.05) return 'No change'
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
      { label: 'Notified Vehicles', baseline: 'Not computed', ai: 'Not computed' },
      { label: 'Relevant-Receiver Precision', baseline: 'Not computed', ai: 'Not computed' },
      { label: 'Communication Load', baseline: 'Not computed', ai: 'Not computed' },
      { label: 'Average Latency', baseline: 'Not computed', ai: 'Not computed' },
    ]
  }
  const baselineCount = pair.baseline.messages.length
  const aiCount = pair.ai.messages.length
  const baselinePrecision = selectionPrecision(pair.baseline)
  const aiPrecision = selectionPrecision(pair.ai)
  return [
    {
      label: 'Notified Vehicles',
      baseline: String(notified(pair.baseline)),
      ai: String(notified(pair.ai)),
      delta: `${Math.max(0, notified(pair.baseline) - notified(pair.ai))} fewer`,
    },
    {
      label: 'Relevant-Receiver Precision',
      baseline: baselinePrecision === null ? 'N/A' : `${baselinePrecision.toFixed(1)}%`,
      ai: aiPrecision === null ? 'N/A' : `${aiPrecision.toFixed(1)}%`,
      delta: baselinePrecision !== null && aiPrecision !== null
        ? `${aiPrecision >= baselinePrecision ? '+' : ''}${(aiPrecision - baselinePrecision).toFixed(1)} pp`
        : undefined,
    },
    {
      label: 'Communication Load',
      baseline: `${baselineCount} transmissions`,
      ai: `${aiCount} transmissions`,
      delta: percentChange(baselineCount, aiCount, true),
    },
    {
      label: 'Average Latency',
      baseline: networkMetricsAvailable ? metricValue(pair.baseline.metrics.avg_delay_ms, ' ms') : 'Not computed',
      ai: networkMetricsAvailable ? metricValue(pair.ai.metrics.avg_delay_ms, ' ms') : 'Not computed',
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
    { label: 'Notified Vehicles', value: String(notifiedVehicles) },
    { label: 'Relevant-Receiver Precision', value: progress < 0.35 || precision === null ? '—' : `${precision.toFixed(1)}%` },
    { label: 'Communication Load', value: update ? `${Math.ceil(update.messages.length * progress)} transmissions` : '0 transmissions' },
    { label: 'Average Latency', value: update && networkMetricsAvailable && progress >= 0.55
      ? `${update.metrics.avg_delay_ms.toFixed(1)} ms` : 'Not computed' },
  ]
}

export function conclusionFor(pair: ComparisonPair | null, networkMetricsAvailable = true): string {
  if (!pair || !networkMetricsAvailable) return 'This is a rule-based preview. Latency and delivery rate require a production-model run.'
  const fewer = notified(pair.ai) < notified(pair.baseline)
  const faster = pair.ai.metrics.avg_delay_ms < pair.baseline.metrics.avg_delay_ms
  if (fewer && faster) return 'In this scenario, selective AI V2X reduced unnecessary broadcasts and estimated communication latency.'
  if (fewer) return 'In this scenario, AI reduced unnecessary broadcasts; refer to the comparison data for latency effects.'
  return 'This scenario shows how AI and broadcast choose different receivers; quantitative benefits are reported by measured metrics.'
}
