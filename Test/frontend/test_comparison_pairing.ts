import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  cacheComparisonUpdate,
  createComparisonUpdateCache,
} from '../../FrontEnd/src/hooks/useWebSocket.ts'
import type { SimulationMethod, StateUpdateMessage } from '../../FrontEnd/src/types/simulation.ts'

function update(timestamp: number, method?: SimulationMethod): StateUpdateMessage {
  return {
    type: 'state_update',
    timestamp,
    method,
    vehicles: [],
    events: [],
    messages: [],
    metrics: { avg_delay_ms: 25, delivery_rate: 0.8, comm_overhead: 1.5 },
    decision: {
      selected_receivers: [],
      priority: 'low',
      bandwidth_allocation: [],
    },
  }
}

describe('comparison state pairing', () => {
  it('promotes a pair only when AI and baseline timestamps match', () => {
    const cache = createComparisonUpdateCache()
    assert.equal(cacheComparisonUpdate(cache, update(1, 'ai')), null)
    assert.equal(cacheComparisonUpdate(cache, update(2, 'distance')), null)

    const pair = cacheComparisonUpdate(cache, update(1, 'distance'))
    assert.equal(pair?.ai.timestamp, 1)
    assert.equal(pair?.baseline.timestamp, 1)
    assert.equal(pair?.baseline.method, 'distance')
  })

  it('accepts baseline-first delivery and ignores single-stream updates', () => {
    const cache = createComparisonUpdateCache()
    assert.equal(cacheComparisonUpdate(cache, update(4, 'urgency')), null)
    const pair = cacheComparisonUpdate(cache, update(4, 'ai'))
    assert.equal(pair?.ai.method, 'ai')
    assert.equal(pair?.baseline.method, 'urgency')
    assert.equal(cacheComparisonUpdate(cache, update(5)), null)
  })
})
