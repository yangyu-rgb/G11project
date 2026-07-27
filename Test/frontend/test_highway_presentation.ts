import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  comparisonMetrics,
  conclusionFor,
  findIncidentPair,
} from '../../FrontEnd/src/components/Presentation/presentationTimeline'
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
import type { ComparisonPair, StateUpdateMessage } from '../../FrontEnd/src/types/simulation'

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
  it('uses one synchronized incident and reports real reductions', () => {
    const pair: ComparisonPair = { ai: update('ai', 3), baseline: update('broadcast', 8) }
    assert.equal(findIncidentPair([pair]), pair)
    const metrics = comparisonMetrics(pair)
    assert.equal(metrics[0].delta, '5 辆更少')
    assert.equal(metrics[1].delta, '+62.5%')
    assert.match(conclusionFor(pair), /减少了不必要广播/)
  })

  it('hides network estimates for the clearly labelled rule fallback', () => {
    const pair: ComparisonPair = { ai: update('ai', 3), baseline: update('broadcast', 8) }
    const metrics = comparisonMetrics(pair, false)
    assert.equal(metrics[2].ai, '未计算')
    assert.match(conclusionFor(pair, false), /规则演示/)
  })
})
