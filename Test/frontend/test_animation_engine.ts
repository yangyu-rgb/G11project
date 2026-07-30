import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AnimationEngine } from '../../FrontEnd/src/engine/AnimationEngine'
import {
  coastVehicle,
  deriveMotion,
  interpolateAngle,
  interpolatePhysics,
  interpolateTrajectory,
} from '../../FrontEnd/src/engine/Interpolator'
import { ParticleSystem } from '../../FrontEnd/src/engine/ParticleSystem'
import { buildSimulationEndpoint } from '../../FrontEnd/src/hooks/useSimulationSession'
import { createAnimationRuntime } from '../../FrontEnd/src/runtime/AnimationRuntimeContext'
import { stageAt } from '../../FrontEnd/src/components/Presentation/presentationTimeline'
import type { StateUpdateMessage } from '../../FrontEnd/src/types/simulation'

function update(x: number, speed: number, heading = 90, timestamp = x): StateUpdateMessage {
  return {
    type: 'state_update', timestamp, events: [], messages: [], attention_weights: [],
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
    assert.notEqual(first.animation, second.animation)
  })

  it('keeps constant-speed motion continuous through a keyframe', () => {
    const from = update(0, 10, 90, 0).vehicles[0]
    const to = update(40, 10, 90, 4).vehicles[0]
    const samples = [0, 0.25, 0.5, 0.75, 1]
      .map((amount) => interpolateTrajectory(from, to, amount, 4).x)
    assert.deepEqual(samples.map((value) => Number(value.toFixed(3))), [0, 10, 20, 30, 40])
  })

  it('replays recorded positions with an event anchor and never moves beyond the final frame', () => {
    const engine = new AnimationEngine(null)
    const frames = [
      update(0, 1, 90, 0),
      { ...update(20, 1, 90, 20), events: [{
        id: 'event-0', type: 'emergency_brake', x: 20, y: 0, timestamp: 20, severity: 0.9,
      }] },
      update(40, 1, 90, 40),
    ]
    engine.loadReplay('single', frames, {
      durationMs: 60_000,
      anchorTimestamp: 20,
      anchorAtMs: 10_000,
    })
    engine.setPaused(true)
    engine.advance(0)
    engine.setReplayElapsed(10_000)
    engine.advance(17)
    assert.equal(Number(engine.getVehicle('single', 'v0')?.x.toFixed(3)), 20)
    engine.setReplayElapsed(90_000)
    engine.advance(34)
    assert.equal(Number(engine.getVehicle('single', 'v0')?.x.toFixed(3)), 40)
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

  it('uses the four-stage 38 second presentation boundaries', () => {
    assert.equal(stageAt(0), 'normal')
    assert.equal(stageAt(5_000), 'accident')
    assert.equal(stageAt(11_000), 'comparison')
    assert.equal(stageAt(20_000), 'comparison')
    assert.equal(stageAt(30_000), 'summary')
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
