import assert from 'node:assert/strict'
import test from 'node:test'

import { evidenceForVehicle, evidenceFrameIndex } from '../../FrontEnd/src/types/research.ts'
import type { ComparisonPair } from '../../FrontEnd/src/types/simulation.ts'
import type { StateUpdateMessage } from '../../FrontEnd/src/types/simulation.ts'

const update: StateUpdateMessage = {
  type: 'state_update', timestamp: 2,
  vehicles: [{ id: 'vehicle_002', x: 10, y: -4.8, vx: 20, vy: 0, heading: 90, status: 'receiving' }],
  events: [{ id: 'event_001', type: 'emergency_braking', x: 0, y: -4.8, timestamp: 2, severity: .9 }],
  messages: [{ from: 'event_001', to: 'vehicle_002', status: 'success', delay_ms: 24 }],
  metrics: { avg_delay_ms: 24, delivery_rate: 1, comm_overhead: 1 },
  attention_weights: [{ vehicle_id: 'vehicle_002', event_id: 'event_001', weight: .72 }],
  decision: {
    selected_receivers: ['vehicle_002'], priority: 'high', bandwidth_allocation: [.4],
    candidate_vehicles: [{ id: 'vehicle_002', distance_m: 30, status: 'selected' }],
    selection_reason: { vehicle_002: 'high_attention' },
  },
}

test('vehicle evidence keeps decision, attention and delivery data aligned', () => {
  const evidence = evidenceForVehicle(update, 'vehicle_002')
  assert.equal(evidence.candidate, true)
  assert.equal(evidence.selected, true)
  assert.equal(evidence.distanceM, 30)
  assert.equal(evidence.attention, .72)
  assert.equal(evidence.bandwidth, .4)
  assert.equal(evidence.delivered, true)
  assert.equal(evidence.delayMs, 24)
})

test('vehicle outside the candidate set is reported without fabricated metrics', () => {
  const evidence = evidenceForVehicle(update, 'vehicle_099')
  assert.equal(evidence.candidate, false)
  assert.equal(evidence.selected, false)
  assert.equal(evidence.distanceM, null)
  assert.equal(evidence.attention, null)
  assert.equal(evidence.delayMs, null)
})

test('research workspace opens on the first frame containing incident evidence', () => {
  const empty = { ...update, timestamp: 0, events: [], messages: [], decision: { ...update.decision, selected_receivers: [] } }
  const pairs: ComparisonPair[] = [
    { ai: empty, baseline: { ...empty, method: 'broadcast' } },
    { ai: update, baseline: { ...update, method: 'broadcast' } },
  ]
  assert.equal(evidenceFrameIndex(pairs), 1)
})
