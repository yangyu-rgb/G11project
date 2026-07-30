import { useEffect, useMemo, useState } from 'react'

import type { AnimatedFrame } from '../engine/AnimationEngine'
import { useAnimationRuntime } from '../runtime/AnimationRuntimeContext'
import type { LiveComparisonTelemetry, MethodTelemetry } from '../types/liveTelemetry'
import type { ComparisonPair, StateUpdateMessage } from '../types/simulation'

function speedKmh(update: StateUpdateMessage | AnimatedFrame, vehicleId: string): number {
  const eventSpeed = update.events.find((event) => event.source_vehicle_id === vehicleId)
    ?.post_brake_speed_kmh
  if (eventSpeed !== null && eventSpeed !== undefined) return eventSpeed
  const vehicle = update.vehicles.find((item) => item.id === vehicleId)
  return vehicle ? Math.hypot(vehicle.vx, vehicle.vy) * 3.6 : 0
}

export function methodTelemetry(update: StateUpdateMessage, replayProgress = 1): MethodTelemetry {
  const progress = Math.max(0, Math.min(1, replayProgress))
  const visibleCount = Math.min(update.messages.length, Math.ceil(update.messages.length * progress))
  const visibleMessages = update.messages.slice(0, visibleCount)
  const delivered = visibleMessages.filter((message) => message.status === 'success')
  const allocatedBandwidth = update.decision.bandwidth_allocation
    .reduce((sum, value) => sum + value, 0)
  const bandwidthFraction = update.decision.bandwidth_fraction
    ?? (allocatedBandwidth > 0 ? allocatedBandwidth : 1)
  return {
    method: update.method ?? 'ai',
    selectedCount: new Set(visibleMessages.map((message) => message.to)).size,
    sentCount: visibleMessages.length,
    successCount: delivered.length,
    timeoutCount: visibleMessages.filter((message) => message.status === 'timeout').length,
    avgDelayMs: delivered.length
      ? delivered.reduce((sum, message) => sum + message.delay_ms, 0) / delivered.length : 0,
    deliveryRate: visibleMessages.length ? delivered.length / visibleMessages.length : 0,
    commOverhead: update.messages.length
      ? update.metrics.comm_overhead * visibleMessages.length / update.messages.length : 0,
    priority: update.decision.priority,
    bandwidthFraction: Math.max(0, Math.min(1, bandwidthFraction)),
  }
}

function percentReduction(baseline: number, ai: number): number | null {
  return baseline > 0 ? (1 - ai / baseline) * 100 : null
}

export function buildLiveTelemetry(pair: ComparisonPair, history: readonly ComparisonPair[],
  accidentVehicleId: string, replayProgress = 1): LiveComparisonTelemetry {
  const baseline = methodTelemetry(pair.baseline, replayProgress)
  const ai = methodTelemetry(pair.ai, replayProgress)
  const currentTimestamp = pair.ai.timestamp
  const visible = history.filter((item) => item.ai.timestamp <= currentTimestamp)
  const speedTrace = visible.map((item) => ({
    timestamp: item.ai.timestamp,
    speedKmh: speedKmh(item.ai, accidentVehicleId),
  }))
  const last = speedTrace[speedTrace.length - 1]
  const previous = speedTrace[speedTrace.length - 2]
  const seconds = last && previous ? Math.max(0.001, last.timestamp - previous.timestamp) : 0
  const decelerationMps2 = seconds > 0
    ? Math.max(0, ((previous.speedKmh - last.speedKmh) / 3.6) / seconds) : 0
  const relations = pair.ai.decision.receiver_relations ?? []
  const behindSameDirection = relations.filter((relation) => (
    relation.outcome !== 'ahead' && relation.outcome !== 'opposite_direction'
  )).length
  const laneRelevant = relations.filter((relation) => (
    relation.outcome !== 'ahead' && relation.outcome !== 'opposite_direction'
      && relation.outcome !== 'outside_lane_scope'
  )).length
  const bandwidth = pair.ai.decision.bandwidth_fraction
    ?? pair.ai.decision.bandwidth_allocation.reduce((sum, value) => sum + value, 0)
  return {
    simulationTimestamp: currentTimestamp,
    replayProgress,
    accidentSpeedKmh: speedKmh(pair.ai, accidentVehicleId),
    decelerationMps2,
    speedTrace,
    baseline,
    ai,
    funnel: {
      evaluated: relations.length,
      behindSameDirection,
      laneRelevant,
      selected: new Set(pair.ai.decision.selected_receivers).size,
    },
    action: {
      corridorRadiusM: pair.ai.decision.corridor_radius_m ?? null,
      laneScope: pair.ai.decision.corridor_lane_scope ?? null,
      priority: pair.ai.decision.priority,
      bandwidthFraction: bandwidth,
    },
    delta: {
      fewerVehicles: Math.max(0, baseline.selectedCount - ai.selectedCount),
      loadReductionPercent: percentReduction(baseline.sentCount, ai.sentCount),
      delayReductionPercent: percentReduction(baseline.avgDelayMs, ai.avgDelayMs),
      deliveryGainPoints: (ai.deliveryRate - baseline.deliveryRate) * 100,
    },
  }
}

function framePair(ai: AnimatedFrame | null, baseline: AnimatedFrame | null): ComparisonPair | null {
  if (!ai || !baseline || Math.abs(ai.timestamp - baseline.timestamp) > 0.001) return null
  return { ai, baseline }
}

export function useLiveComparisonTelemetry(history: readonly ComparisonPair[], accidentVehicleId: string | null,
  displayPair?: ComparisonPair | null, replayProgress = 1) {
  const { animation } = useAnimationRuntime()
  const [aiFrame, setAiFrame] = useState<AnimatedFrame | null>(null)
  const [baselineFrame, setBaselineFrame] = useState<AnimatedFrame | null>(null)

  useEffect(() => {
    let lastAiUpdate = -Infinity
    let lastBaselineUpdate = -Infinity
    const unsubscribeAi = animation.subscribe('comparison-ai', (frame) => {
      if (frame.animationTimeMs - lastAiUpdate < 100) return
      lastAiUpdate = frame.animationTimeMs
      setAiFrame(frame)
    })
    const unsubscribeBaseline = animation.subscribe('comparison-baseline', (frame) => {
      if (frame.animationTimeMs - lastBaselineUpdate < 100) return
      lastBaselineUpdate = frame.animationTimeMs
      setBaselineFrame(frame)
    })
    return () => { unsubscribeAi(); unsubscribeBaseline() }
  }, [animation])

  const animatedPair = useMemo(() => framePair(aiFrame, baselineFrame), [aiFrame, baselineFrame])
  const pair = displayPair ?? animatedPair
  const quantizedProgress = Math.floor(Math.max(0, Math.min(1, replayProgress)) * 20) / 20
  const telemetry = useMemo(() => pair && accidentVehicleId
    ? buildLiveTelemetry(pair, history, accidentVehicleId, quantizedProgress) : null,
  [accidentVehicleId, history, pair, quantizedProgress])
  return { pair, telemetry }
}
