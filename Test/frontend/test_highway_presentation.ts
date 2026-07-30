import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  comparisonMetrics,
  comparisonModeAt,
  conclusionFor,
  findIncidentPair,
  presentationCueAt,
  selectionPrecision,
  stageAt,
} from '../../FrontEnd/src/components/Presentation/presentationTimeline'
import {
  decisionPipelineData,
  traceSeries,
} from '../../FrontEnd/src/components/Presentation/AcademicEvidence'
import { buildLiveTelemetry } from '../../FrontEnd/src/hooks/useLiveComparisonTelemetry'
import {
  aggregateDirectedTransmissions,
  communicationVisualStyle,
  linkLifecycleAt,
  orderTransmissionsByPriority,
  packetCountForBandwidth,
  packetCycleForDelay,
} from '../../FrontEnd/src/components/ThreeD/communicationLinks'
import {
  HIGHWAY_LANE_CENTERS_METERS,
  HIGHWAY_LANE_WIDTH,
  HIGHWAY_VEHICLE_WIDTH,
  toSceneHeading,
  toScenePosition,
  toScreenHeading,
} from '../../FrontEnd/src/components/ThreeD/sceneCoordinates'
import { enforceHighwaySpacing } from '../../FrontEnd/src/components/ThreeD/highwaySpacing'
import {
  PRESENTATION_VEHICLE_COLORS,
  presentationVehicleColor,
} from '../../FrontEnd/src/components/ThreeD/vehiclePresentationColors'
import {
  beginManualCamera,
  clampCameraTarget,
  endManualCamera,
  requestDirectedCamera,
  settleDirectedCamera,
} from '../../FrontEnd/src/components/ThreeD/cameraControl'
import type { ComparisonPair, StateUpdateMessage } from '../../FrontEnd/src/types/simulation'
import { RESEARCH_EVIDENCE_FRAME_FROZEN } from '../../FrontEnd/src/types/research'

function update(method: 'ai' | 'broadcast', messages: number): StateUpdateMessage {
  return {
    type: 'state_update', timestamp: 2, method,
    vehicles: Array.from({ length: 12 }, (_, index) => ({
      id: `v${index}`, x: index * 30, y: HIGHWAY_LANE_CENTERS_METERS[index % 3],
      vx: 20, vy: 0, heading: 90, status: index < 3 ? 'receiving' as const : 'normal' as const,
    })),
    events: [{ id: 'e0', type: 'emergency_brake', x: 120, y: -4.8, timestamp: 2, severity: 0.9 }],
    messages: Array.from({ length: messages }, (_, index) => ({
      from: 'v0', to: `v${index + 1}`, status: 'success' as const, delay_ms: 20 + index,
    })),
    metrics: { avg_delay_ms: method === 'ai' ? 24 : 34, delivery_rate: 1, comm_overhead: method === 'ai' ? 1.2 : 2.4 },
    decision: {
      selected_receivers: Array.from({ length: messages }, (_, index) => `v${index + 1}`),
      priority: 'high', bandwidth_allocation: [],
      candidate_vehicles: Array.from({ length: 8 }, (_, index) => ({
        id: `v${index + 1}`, distance_m: 30 + index * 10, status: 'candidate',
      })),
    },
  }
}

describe('highway presentation geometry', () => {
  it('uses physical three-lane proportions and the correct driving direction', () => {
    assert.equal(toScreenHeading(90), 0)
    assert.ok(Math.abs(toSceneHeading(90, 'highway')) < 1e-12)
    const centres = HIGHWAY_LANE_CENTERS_METERS.map((y) => toScenePosition(0, y, 'highway')[2])
    assert.deepEqual(centres.map((value) => Number(value.toFixed(3))), [-0.256, 0, 0.256])
    assert.equal(Number((centres[1] - centres[0]).toFixed(3)), HIGHWAY_LANE_WIDTH)
    assert(HIGHWAY_VEHICLE_WIDTH < HIGHWAY_LANE_WIDTH)
  })

  it('enforces an eight metre visual gap without moving cars between lanes', () => {
    const vehicles = update('ai', 2).vehicles.slice(0, 3).map((vehicle, index) => ({
      ...vehicle, x: 100 - index * 3, y: -4.8,
    }))
    const corrected = enforceHighwaySpacing(vehicles).sort((left, right) => right.x - left.x)
    assert(corrected.every((vehicle) => vehicle.y === -4.8))
    assert(corrected.every((vehicle, index) => index === 0 || corrected[index - 1].x - vehicle.x >= 8))
  })
})

describe('highway presentation vehicle colors', () => {
  const vehicle = update('ai', 2).vehicles[1]

  it('uses body colors without weakening the accident priority', () => {
    const candidates = new Set([vehicle.id])
    const notified = new Set([vehicle.id])
    assert.equal(presentationVehicleColor(vehicle, null, vehicle.id, candidates, notified),
      PRESENTATION_VEHICLE_COLORS.accident)
    assert.equal(presentationVehicleColor({ ...vehicle, motion: 'braking' }, null, null, candidates, notified),
      PRESENTATION_VEHICLE_COLORS.notified)
    assert.equal(presentationVehicleColor(vehicle, null, null, candidates, notified),
      PRESENTATION_VEHICLE_COLORS.notified)
    assert.equal(presentationVehicleColor(vehicle, null, null, candidates, new Set()),
      PRESENTATION_VEHICLE_COLORS.candidate)
    assert.equal(presentationVehicleColor({ ...vehicle, status: 'receiving' }, null, null, new Set(), new Set()),
      PRESENTATION_VEHICLE_COLORS.unrelated)
  })
})

describe('highway comparison evidence', () => {
  it('freezes laboratory evidence so messages and vehicle positions use one frame', () => {
    assert.equal(RESEARCH_EVIDENCE_FRAME_FROZEN, true)
  })

  it('uses one synchronized incident and reports real reductions', () => {
    const pair: ComparisonPair = { ai: update('ai', 3), baseline: update('broadcast', 8) }
    assert.equal(findIncidentPair([pair]), pair)
    const metrics = comparisonMetrics(pair)
    assert.equal(metrics[0].delta, '5 fewer')
    assert.equal(metrics[2].delta, '+62.5%')
    assert.match(conclusionFor(pair), /reduced unnecessary broadcasts/)
  })

  it('hides network estimates for the clearly labelled rule fallback', () => {
    const pair: ComparisonPair = { ai: update('ai', 3), baseline: update('broadcast', 8) }
    const metrics = comparisonMetrics(pair, false)
    assert.equal(metrics[3].ai, 'Not computed')
    assert.match(conclusionFor(pair, false), /rule-based preview/)
  })

  it('derives receiver precision from the existing candidate set', () => {
    const baseline = update('broadcast', 8)
    baseline.decision.candidate_vehicles = baseline.decision.candidate_vehicles?.slice(0, 3)
    assert.equal(selectionPrecision(baseline), 37.5)
    assert.equal(selectionPrecision(update('ai', 3)), 100)
  })

  it('aggregates duplicate visual links without changing raw message evidence', () => {
    const duplicate = { from: 'v0', to: 'v1', status: 'success' as const, delay_ms: 12 }
    const timeout = { ...duplicate, status: 'timeout' as const, delay_ms: 38 }
    const raw = [duplicate, { ...duplicate }, timeout, { ...duplicate, to: 'v2' }]
    const visual = aggregateDirectedTransmissions(raw)
    assert.equal(raw.length, 4)
    assert.equal(visual.length, 2)
    assert.equal(visual.find((message) => message.to === 'v1')?.status, 'timeout')
  })

  it('maps measured network evidence to restrained academic link encoding', () => {
    assert.equal(packetCountForBandwidth(0), 1)
    assert.equal(packetCountForBandwidth(0.4), 2)
    assert.equal(packetCountForBandwidth(1), 3)
    assert.equal(packetCycleForDelay(20), 620)
    assert.equal(packetCycleForDelay(80), 1_440)
    assert.equal(packetCycleForDelay(200), 1_750)
    const ai = communicationVisualStyle('ai', 'success', 25, 0.4, 1, 14)
    const baseline = communicationVisualStyle('baseline', 'success', 25, 1, 1, 14)
    const timeout = communicationVisualStyle('ai', 'timeout', 120, 0.4, 1, 14)
    assert.equal(ai.color, '#3de4c2')
    assert.equal(baseline.color, '#d6a75d')
    assert.equal(timeout.color, '#ff5669')
    assert.equal(ai.packetCount, 2)
    assert.equal(baseline.packetCount, 3)
    assert(baseline.lateralOffset > ai.lateralOffset)
  })
})

describe('academic presentation choreography', () => {
  it('keeps the four-stage contract and exposes deterministic sub-stage cues', () => {
    assert.equal(stageAt(4_999), 'normal')
    assert.equal(stageAt(5_000), 'accident')
    assert.equal(stageAt(11_000), 'comparison')
    assert.equal(stageAt(20_000), 'comparison')
    assert.equal(stageAt(30_000), 'summary')
    assert.equal(presentationCueAt(11_000).linkRevealProgress, 0)
    assert(presentationCueAt(14_000).linkRevealProgress > 0.99)
    assert(presentationCueAt(20_000).linkRevealProgress > 0.99)
    assert.equal(presentationCueAt(30_000).linkRevealProgress, 1)
    assert.equal(presentationCueAt(30_450).summaryMetricCount, 1)
    assert.equal(presentationCueAt(35_300).showSummaryTagline, true)
  })

  it('enters synchronized comparison at the summary boundary while preserving manual control', () => {
    assert.equal(comparisonModeAt('comparison', null), true)
    assert.equal(comparisonModeAt('summary', null), true)
    assert.equal(comparisonModeAt('summary', false), false)
    assert.equal(comparisonModeAt('normal', true), true)
  })

  it('derives the four-step academic decision chain only from the real state update', () => {
    const ai = update('ai', 3)
    ai.events[0].severity = 0.85
    ai.attention_weights = [{ vehicle_id: 'v2', event_id: 'e0', weight: 0.72 }]
    ai.decision.action_mode = 'directional_corridor'
    ai.decision.corridor_radius_m = 300
    ai.decision.corridor_lane_scope = 'same_and_adjacent'
    ai.decision.bandwidth_fraction = 0.4
    const steps = decisionPipelineData(ai)
    assert.equal(steps.length, 4)
    assert.match(steps[0].primary, /Severity 0.85/)
    assert.match(steps[1].primary, /v2.*72.0%/)
    assert.match(steps[2].primary, /300 m.*same \+ adjacent lanes/)
    assert.match(steps[2].secondary, /40% bandwidth/)
    assert.match(steps[3].primary, /3 selected/)
  })

  it('builds synchronized live traces from pair timestamps without inventing samples', () => {
    const first: ComparisonPair = { ai: update('ai', 2), baseline: update('broadcast', 7) }
    const second: ComparisonPair = {
      ai: { ...update('ai', 3), timestamp: 4 },
      baseline: { ...update('broadcast', 8), timestamp: 4 },
    }
    const series = traceSeries([first, second])
    assert.deepEqual(series.map((point) => point.progress), [0, 1])
    assert.deepEqual(series.map((point) => point.aiReceivers), [2, 3])
    assert.deepEqual(series.map((point) => point.baselineReceivers), [7, 8])
  })

  it('derives current-frame telemetry and PPO funnel from synchronized evidence', () => {
    const pair: ComparisonPair = { ai: update('ai', 3), baseline: update('broadcast', 8) }
    pair.ai.decision.receiver_relations = [
      { id: 'v1', distance_m: 30, longitudinal_m: -30, lateral_m: 0, lane_relation: 'same',
        risk_class: 'following_lane', selected: true, outcome: 'selected', corridor_limit_m: 300 },
      { id: 'v2', distance_m: 50, longitudinal_m: 50, lateral_m: 0, lane_relation: 'same',
        risk_class: 'ahead', selected: false, outcome: 'ahead', corridor_limit_m: 300 },
    ]
    pair.ai.decision.action_mode = 'directional_corridor'
    pair.ai.decision.corridor_radius_m = 300
    pair.ai.decision.corridor_lane_scope = 'same_and_adjacent'
    pair.ai.decision.bandwidth_fraction = 0.4
    pair.ai.events[0].source_vehicle_id = 'v0'
    pair.ai.events[0].pre_brake_speed_kmh = 96
    pair.ai.events[0].post_brake_speed_kmh = 18
    const telemetry = buildLiveTelemetry(pair, [pair], 'v0')
    assert.equal(telemetry.baseline.selectedCount, 8)
    assert.equal(telemetry.ai.selectedCount, 3)
    assert.equal(telemetry.funnel.behindSameDirection, 1)
    assert.equal(telemetry.action.corridorRadiusM, 300)
    assert.equal(telemetry.baseline.priority, 'high')
    assert.equal(telemetry.baseline.bandwidthFraction, 1)
    assert.equal(telemetry.ai.bandwidthFraction, 0.4)
    assert.equal(telemetry.delta.fewerVehicles, 5)
    assert.equal(telemetry.delta.loadReductionPercent, 62.5)
    assert.equal(telemetry.accidentSpeedKmh, 18)
    const partial = buildLiveTelemetry(pair, [pair], 'v0', 0.5)
    assert.equal(partial.baseline.sentCount, 4)
    assert.equal(partial.ai.sentCount, 2)
  })

  it('stages link propagation and orders AI links by existing attention evidence', () => {
    assert.equal(linkLifecycleAt(0, 8, 0).phase, 'pending')
    assert.equal(linkLifecycleAt(0, 8, 0.15).phase, 'transmitting')
    assert.equal(linkLifecycleAt(0, 8, 1).phase, 'delivered')
    assert.equal(linkLifecycleAt(7, 8, 0.5).phase, 'pending')
    const messages = update('ai', 3).messages
    const ordered = orderTransmissionsByPriority(messages, { v1: 0.2, v2: 0.95, v3: 0.5 })
    assert.deepEqual(ordered.map((message) => message.to), ['v2', 'v3', 'v1'])
  })
})

describe('follow camera takeover', () => {
  it('keeps manual control until the user explicitly requests a directed shot', () => {
    assert.deepEqual(beginManualCamera(), { mode: 'free' })
    assert.deepEqual(endManualCamera(), { mode: 'free' })
    assert.equal(requestDirectedCamera().mode, 'returning')
    assert.equal(settleDirectedCamera().mode, 'directed')
  })

  it('allows a new gesture to interrupt camera return immediately', () => {
    assert.equal(requestDirectedCamera().mode, 'returning')
    assert.equal(beginManualCamera().mode, 'free')
  })

  it('keeps camera panning near the highway without changing valid targets', () => {
    assert.deepEqual(clampCameraTarget([160, 4, -6]), [160, 4, -6])
    assert.deepEqual(clampCameraTarget([-20, -3, -40]), [0, 0, -18])
    assert.deepEqual(clampCameraTarget([470, 20, 35]), [400, 12, 18])
  })
})
