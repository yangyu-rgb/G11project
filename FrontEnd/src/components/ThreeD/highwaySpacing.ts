import type { SimulationVehicle } from '../../types/simulation'
import {
  HIGHWAY_LANE_CENTERS_METERS,
  HIGHWAY_MINIMUM_GAP,
  nearestHighwayLaneIndex,
  SCENE_SCALE,
} from './sceneCoordinates'

export function enforceHighwaySpacing<T extends SimulationVehicle>(vehicles: readonly T[]): T[] {
  const copies = vehicles.map((vehicle) => ({ ...vehicle })) as T[]
  const lanes = new Map<number, T[]>()
  for (const vehicle of copies) {
    const lane = nearestHighwayLaneIndex(vehicle.y)
    vehicle.y = HIGHWAY_LANE_CENTERS_METERS[lane]
    lanes.set(lane, [...(lanes.get(lane) ?? []), vehicle])
  }
  const minimumGapMeters = HIGHWAY_MINIMUM_GAP / SCENE_SCALE
  for (const laneVehicles of lanes.values()) {
    laneVehicles.sort((left, right) => right.x - left.x)
    for (let index = 1; index < laneVehicles.length; index += 1) {
      const leader = laneVehicles[index - 1]
      const follower = laneVehicles[index]
      if (leader.x - follower.x < minimumGapMeters) follower.x = leader.x - minimumGapMeters
    }
  }
  return copies
}
