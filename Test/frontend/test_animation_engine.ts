import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AnimationEngine } from '../../FrontEnd/src/engine/AnimationEngine'
import {
  coastVehicle,
  deriveMotion,
  interpolateAngle,
  interpolatePhysics,
} from '../../FrontEnd/src/engine/Interpolator'
import { ParticleSystem } from '../../FrontEnd/src/engine/ParticleSystem'
import { buildSimulationEndpoint } from '../../FrontEnd/src/hooks/useSimulationSession'
import { createAnimationRuntime } from '../../FrontEnd/src/runtime/AnimationRuntimeContext'
import {
  NarrativeStage,
  narrativeStageAt,
} from '../../FrontEnd/src/components/DemoMode/NarrativeStages'
import type { StateUpdateMessage } from '../../FrontEnd/src/types/simulation'

function update(x: number, speed: number, heading = 90): StateUpdateMessage {
  return {
    type: 'state_update', timestamp: x, events: [], messages: [], attention_weights: [],
    vehicles: [{ id: 'v0', x, y: 0, vx: speed, vy: 0, heading, status: 'normal' }],
    metrics: { avg_delay_ms: 0, delivery_rate: 0, comm_overhead: 0 },
    decision: { selected_receivers: [], priority: 'low', bandwidth_allocation: [] },
  }
}

describe('continuous animation engine', () => {
  it('interpolates keyframes and follows the shortest angle path', () => {
    const engine = new AnimationEngine(null)
    engine.setKeyframeInterval(1000)
    engine.pushTarget('single', update(0, 10, 350))
    engine.advance(0)
    engine.advance(17)
    engine.pushTarget('single', update(100, 10, 10))
    for (let now = 34; now <= 534; now += 17) engine.advance(now)
    const vehicle = engine.getVehicle('single', 'v0')
    assert(vehicle)
    assert(vehicle.x > 30 && vehicle.x < 70)
    assert(vehicle.heading < 20 || vehicle.heading > 340)
    assert.equal(interpolateAngle(350, 10, 0.5), 0)
  })

  it('derives braking motion and coasts to a slower speed after disconnect', () => {
    const from = update(0, 20).vehicles[0]
    const to = update(15, 4).vehicles[0]
    assert.equal(deriveMotion(from, to), 'braking')
    const braking = interpolatePhysics(from, to, 0.5)
    assert(braking.pitch > 0)
    const coasted = coastVehicle({ ...from, motion: 'cruising', pitch: 0 }, 0.5)
    assert(coasted.x > from.x)
    assert(Math.hypot(coasted.vx, coasted.vy) < Math.hypot(from.vx, from.vy))
  })

  it('applies global slow motion without stopping frame publication', () => {
    const engine = new AnimationEngine(null)
    engine.pushTarget('single', update(0, 10))
    engine.advance(0)
    engine.setTimeScale(0.3)
    engine.advance(17)
    assert.equal(engine.getTimeScale(), 0.3)
    assert.equal(engine.getSnapshot('single')?.animationTimeMs, 5.1)
  })

  it('keeps injected animation runtimes isolated', () => {
    const first = createAnimationRuntime()
    const second = createAnimationRuntime()
    first.animation.pushTarget('single', update(0, 10))
    assert(first.animation.getSnapshot('single'))
    assert.equal(second.animation.getSnapshot('single'), null)
    assert.notEqual(first.camera, second.camera)
  })
})

describe('particle pool and narrative timing', () => {
  it('reuses a bounded particle pool for concurrent messages', () => {
    const system = new ParticleSystem(50)
    const vehicles = [
      { id: 'v0', x: 0, y: 0, vx: 0, vy: 0, heading: 0, status: 'sending' as const },
      { id: 'v1', x: 100, y: 0, vx: 0, vy: 0, heading: 0, status: 'receiving' as const },
    ]
    system.ingest([{ from: 'v0', to: 'v1', status: 'success', delay_ms: 25 }], vehicles, 1, 0, 'ai')
    assert.equal(system.activeCount(), 26)
    assert(system.update(500).length > 0)
    system.ingest([{ from: 'v0', to: 'v1', status: 'success', delay_ms: 25 }], vehicles, 1, 500, 'ai')
    assert.equal(system.activeCount(), 26)
  })

  it('uses the architect-defined eight stage boundaries', () => {
    assert.equal(narrativeStageAt(0).stage, NarrativeStage.OPENING)
    assert.equal(narrativeStageAt(10_000).stage, NarrativeStage.EVENT_TRIGGERED)
    assert.equal(narrativeStageAt(45_000).stage, NarrativeStage.COMPARISON)
    assert.equal(narrativeStageAt(59_999).stage, NarrativeStage.COMPARISON)
  })

  it('builds stable single and comparison WebSocket endpoints', () => {
    const base = {
      scenario: 'experiments/test_scenario',
      model: 'experiments/test_ppo/model.zip',
      speed: 0.25,
      mode: 'single' as const,
      baseline: 'broadcast' as const,
    }
    assert.match(buildSimulationEndpoint(base, 3), /^\/ws\/simulation\/run\?/)
    const comparison = buildSimulationEndpoint({ ...base, mode: 'comparison' }, 4)
    assert.match(comparison, /^\/ws\/simulation\/compare\?/)
    assert.match(comparison, /speed=0.25/)
    assert.match(comparison, /baseline=broadcast/)
  })
})
