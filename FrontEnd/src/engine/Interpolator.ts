import type { SimulationVehicle } from '../types/simulation'

export type VehicleMotion = 'cruising' | 'accelerating' | 'braking'

export type AnimatedVehicle = SimulationVehicle & {
  motion: VehicleMotion
  pitch: number
}

const EPSILON = 1e-6

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function easeInOutCubic(value: number): number {
  const t = clamp01(value)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutCubic(value: number): number {
  const t = clamp01(value)
  return 1 - Math.pow(1 - t, 3)
}

export function exponentialBrake(value: number): number {
  const t = clamp01(value)
  return (1 - Math.exp(-5 * t)) / (1 - Math.exp(-5))
}

export function interpolatePosition(from: number, to: number, amount: number): number {
  return from + (to - from) * easeInOutCubic(amount)
}

export function interpolateAngle(from: number, to: number, amount: number): number {
  const shortestDelta = ((to - from + 540) % 360) - 180
  return (from + shortestDelta * easeInOutCubic(amount) + 360) % 360
}

export function vehicleSpeed(vehicle: Pick<SimulationVehicle, 'vx' | 'vy'>): number {
  return Math.hypot(vehicle.vx, vehicle.vy)
}

export function deriveMotion(
  from: SimulationVehicle,
  to: SimulationVehicle,
  forcedBraking = false,
): VehicleMotion {
  const delta = vehicleSpeed(to) - vehicleSpeed(from)
  if (forcedBraking || delta < -1.5) return 'braking'
  if (delta > 1.5) return 'accelerating'
  return 'cruising'
}

export function interpolatePhysics(
  from: SimulationVehicle,
  to: SimulationVehicle,
  amount: number,
  forcedBraking = false,
): AnimatedVehicle {
  const t = clamp01(amount)
  const motion = deriveMotion(from, to, forcedBraking)
  const progress = motion === 'braking'
    ? exponentialBrake(t)
    : motion === 'accelerating' ? easeOutCubic(t) : easeInOutCubic(t)
  return {
    ...to,
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    vx: from.vx + (to.vx - from.vx) * progress,
    vy: from.vy + (to.vy - from.vy) * progress,
    heading: interpolateAngle(from.heading, to.heading, t),
    motion,
    pitch: motion === 'braking' ? 5 * Math.sin(Math.PI * t) : 0,
  }
}

function hermite(from: number, to: number, fromTangent: number, toTangent: number, amount: number): number {
  const t = clamp01(amount)
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * from
    + (t3 - 2 * t2 + t) * fromTangent
    + (-2 * t3 + 3 * t2) * to
    + (t3 - t2) * toTangent
}

function boundedTangent(delta: number, velocity: number, durationSeconds: number): number {
  if (Math.abs(delta) <= EPSILON || Math.sign(delta) !== Math.sign(velocity)) return 0
  return Math.sign(delta) * Math.min(Math.abs(velocity * durationSeconds), Math.abs(delta) * 3)
}

export function interpolateTrajectory(
  from: SimulationVehicle,
  to: SimulationVehicle,
  amount: number,
  durationSeconds: number,
  forcedBraking = false,
): AnimatedVehicle {
  const t = clamp01(amount)
  const motion = deriveMotion(from, to, forcedBraking)
  const xDelta = to.x - from.x
  const yDelta = to.y - from.y
  const x = hermite(
    from.x,
    to.x,
    boundedTangent(xDelta, from.vx, durationSeconds),
    boundedTangent(xDelta, to.vx, durationSeconds),
    t,
  )
  const y = hermite(
    from.y,
    to.y,
    boundedTangent(yDelta, from.vy, durationSeconds),
    boundedTangent(yDelta, to.vy, durationSeconds),
    t,
  )
  return {
    ...to,
    x,
    y,
    vx: from.vx + (to.vx - from.vx) * t,
    vy: from.vy + (to.vy - from.vy) * t,
    heading: interpolateAngle(from.heading, to.heading, t),
    motion,
    pitch: motion === 'braking' ? 5 * Math.sin(Math.PI * t) : 0,
  }
}

export function predictVehicle(
  vehicle: AnimatedVehicle,
  deltaSeconds: number,
  simulationRate = 1,
): AnimatedVehicle {
  const seconds = Math.max(0, deltaSeconds) * Math.max(0, simulationRate)
  return {
    ...vehicle,
    x: vehicle.x + vehicle.vx * seconds,
    y: vehicle.y + vehicle.vy * seconds,
    pitch: 0,
  }
}

export function coastVehicle(vehicle: AnimatedVehicle, deltaSeconds: number): AnimatedVehicle {
  const speed = vehicleSpeed(vehicle)
  if (speed < 0.05 || deltaSeconds <= EPSILON) {
    return { ...vehicle, vx: 0, vy: 0, motion: 'braking', pitch: 0 }
  }
  const decay = Math.exp(-deltaSeconds / 0.8)
  const distanceScale = 0.8 * (1 - decay)
  return {
    ...vehicle,
    x: vehicle.x + vehicle.vx * distanceScale,
    y: vehicle.y + vehicle.vy * distanceScale,
    vx: vehicle.vx * decay,
    vy: vehicle.vy * decay,
    motion: 'braking',
    pitch: Math.min(5, speed * 0.18) * decay,
  }
}
