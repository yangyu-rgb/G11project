import type { SimulationTransmission, SimulationVehicle } from '../types/simulation'

export type ParticleTone = 'ai' | 'baseline'

export type RenderParticle = {
  x: number
  y: number
  height: number
  alpha: number
  color: string
  size: number
}

type Particle = {
  active: boolean
  key: string
  fromX: number
  fromY: number
  controlX: number
  controlY: number
  toX: number
  toY: number
  arcHeight: number
  startedAt: number
  durationMs: number
  offset: number
  status: SimulationTransmission['status']
  tone: ParticleTone
}

const AI_COLORS = { moving: '#3b82f6', success: '#22c55e', timeout: '#ef4444' }
const BASELINE_COLORS = { moving: '#94a3b8', success: '#94a3b8', timeout: '#64748b' }

function quadratic(from: number, control: number, to: number, t: number): number {
  const inverse = 1 - t
  return inverse * inverse * from + 2 * inverse * t * control + t * t * to
}

function messageKey(message: SimulationTransmission, timestamp: number, index: number): string {
  return `${timestamp}:${message.from}:${message.to}:${message.status}:${index}`
}

export class ParticleSystem {
  private readonly pool: Particle[]
  private readonly seen = new Set<string>()

  constructor(capacity = 1500) {
    this.pool = Array.from({ length: capacity }, () => ({
      active: false,
      key: '',
      fromX: 0,
      fromY: 0,
      controlX: 0,
      controlY: 0,
      toX: 0,
      toY: 0,
      arcHeight: 0,
      startedAt: 0,
      durationMs: 0,
      offset: 0,
      status: 'success',
      tone: 'ai',
    }))
  }

  ingest(
    messages: readonly SimulationTransmission[],
    vehicles: readonly SimulationVehicle[],
    timestamp: number,
    animationTimeMs: number,
    tone: ParticleTone,
  ): void {
    const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
    messages.forEach((message, messageIndex) => {
      const key = messageKey(message, timestamp, messageIndex)
      if (this.seen.has(key)) return
      const sender = byId.get(message.from)
      const receiver = byId.get(message.to)
      if (!sender || !receiver) return
      this.seen.add(key)
      const dx = receiver.x - sender.x
      const dy = receiver.y - sender.y
      const length = Math.max(1, Math.hypot(dx, dy))
      const direction = messageIndex % 2 === 0 ? 1 : -1
      const lateral = direction * (8 + (messageIndex % 3) * 6)
      const controlX = (sender.x + receiver.x) / 2 - (dy / length) * lateral
      const controlY = (sender.y + receiver.y) / 2 + (dx / length) * lateral
      const count = tone === 'baseline' ? 20 : 26
      for (let index = 0; index < count; index += 1) {
        const particle = this.pool.find((candidate) => !candidate.active)
        if (!particle) break
        Object.assign(particle, {
          active: true,
          key,
          fromX: sender.x,
          fromY: sender.y,
          controlX,
          controlY,
          toX: receiver.x,
          toY: receiver.y,
          arcHeight: Math.min(80, 12 + length * 0.12),
          startedAt: animationTimeMs,
          durationMs: 900 + Math.min(700, message.delay_ms * 8),
          offset: index / count,
          status: message.status,
          tone,
        })
      }
    })
  }

  update(animationTimeMs: number): RenderParticle[] {
    const rendered: RenderParticle[] = []
    for (const particle of this.pool) {
      if (!particle.active) continue
      const raw = (animationTimeMs - particle.startedAt) / particle.durationMs
      const progress = raw * 1.08 - particle.offset * 0.72
      if (progress > 1.15) {
        particle.active = false
        continue
      }
      if (progress < 0) continue
      const t = Math.min(1, progress)
      const palette = particle.tone === 'ai' ? AI_COLORS : BASELINE_COLORS
      const terminal = t > 0.86
      const color = terminal
        ? palette[particle.status === 'success' ? 'success' : 'timeout']
        : palette.moving
      const alpha = particle.status === 'timeout' && terminal
        ? Math.max(0, (1 - t) / 0.14)
        : Math.min(1, t * 7, (1.08 - t) * 8)
      rendered.push({
        x: quadratic(particle.fromX, particle.controlX, particle.toX, t),
        y: quadratic(particle.fromY, particle.controlY, particle.toY, t),
        height: Math.sin(Math.PI * t) * particle.arcHeight,
        alpha: alpha * (particle.tone === 'baseline' ? 0.48 : 0.95),
        color,
        size: particle.tone === 'baseline' ? 1.7 : 2.7,
      })
    }
    return rendered
  }

  activeCount(): number {
    return this.pool.filter((particle) => particle.active).length
  }

  clear(): void {
    for (const particle of this.pool) particle.active = false
    this.seen.clear()
  }
}
