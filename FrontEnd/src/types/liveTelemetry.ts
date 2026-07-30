import type { ComparisonBaseline } from './simulation'

export type MethodTelemetry = {
  method: 'ai' | ComparisonBaseline
  selectedCount: number
  sentCount: number
  successCount: number
  timeoutCount: number
  avgDelayMs: number
  deliveryRate: number
  commOverhead: number
  priority: string
  bandwidthFraction: number
}

export type FunnelTelemetry = {
  evaluated: number
  behindSameDirection: number
  laneRelevant: number
  selected: number
}

export type PolicyActionTelemetry = {
  corridorRadiusM: number | null
  laneScope: string | null
  priority: string
  bandwidthFraction: number
}

export type SpeedTracePoint = { timestamp: number; speedKmh: number }

export type LiveComparisonTelemetry = {
  simulationTimestamp: number
  replayProgress: number
  accidentSpeedKmh: number
  decelerationMps2: number
  speedTrace: SpeedTracePoint[]
  baseline: MethodTelemetry
  ai: MethodTelemetry
  funnel: FunnelTelemetry
  action: PolicyActionTelemetry
  delta: {
    fewerVehicles: number
    loadReductionPercent: number | null
    delayReductionPercent: number | null
    deliveryGainPoints: number
  }
}
