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
