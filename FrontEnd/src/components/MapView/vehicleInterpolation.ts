import type { SimulationVehicle } from '../../types/simulation'
import { interpolateHeading, lerp } from '../../utils/interpolation'

export const VEHICLE_INTERPOLATION_DURATION_MS = 150

export function interpolateVehicle(
  start: SimulationVehicle,
  end: SimulationVehicle,
  amount: number,
): SimulationVehicle {
  return {
    ...end,
    x: lerp(start.x, end.x, amount),
    y: lerp(start.y, end.y, amount),
    vx: lerp(start.vx, end.vx, amount),
    vy: lerp(start.vy, end.vy, amount),
    heading: interpolateHeading(start.heading, end.heading, amount),
  }
}

export function interpolateVehicles(
  starts: readonly SimulationVehicle[],
  ends: readonly SimulationVehicle[],
  amount: number,
): SimulationVehicle[] {
  const startsById = new Map(starts.map((vehicle) => [vehicle.id, vehicle]))
  return ends.map((end) => {
    const start = startsById.get(end.id)
    return start ? interpolateVehicle(start, end, amount) : end
  })
}
