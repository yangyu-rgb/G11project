import type { SceneLayout } from './Road3D'

export const SCENE_SCALE = 0.08
export const HIGHWAY_LANE_WIDTH = 3.2 * SCENE_SCALE
export const HIGHWAY_VEHICLE_WIDTH = 1.9 * SCENE_SCALE
export const HIGHWAY_VEHICLE_LENGTH = 4.8 * SCENE_SCALE
export const HIGHWAY_MINIMUM_GAP = 8 * SCENE_SCALE
export const HIGHWAY_LANE_CENTERS_METERS = [-8, -4.8, -1.6] as const
export const HIGHWAY_CENTER_Y_METERS = -4.8
export const HIGHWAY_LATERAL_SCALE = SCENE_SCALE

function lateralScale(layout: SceneLayout): number {
  return layout === 'highway' ? HIGHWAY_LATERAL_SCALE : SCENE_SCALE
}

export function toScenePosition(
  x: number,
  y: number,
  layout: SceneLayout = 'custom',
): [number, number, number] {
  const centeredY = layout === 'highway' ? y - HIGHWAY_CENTER_Y_METERS : y
  return [x * SCENE_SCALE, 0, centeredY * lateralScale(layout)]
}

export function toSceneDelta(
  x: number,
  y: number,
  layout: SceneLayout = 'custom',
): [number, number, number] {
  return [x * SCENE_SCALE, 0, y * lateralScale(layout)]
}

export function toSceneHeading(heading: number, layout: SceneLayout = 'custom'): number {
  const radians = (heading * Math.PI) / 180
  const x = Math.sin(radians) * SCENE_SCALE
  const z = Math.cos(radians) * lateralScale(layout)
  return Math.atan2(-z, x)
}

export function toScreenHeading(heading: number): number {
  return ((heading - 90 + 540) % 360) - 180
}

export function nearestHighwayLaneIndex(y: number): number {
  return HIGHWAY_LANE_CENTERS_METERS.reduce((best, center, index) => (
    Math.abs(y - center) < Math.abs(y - HIGHWAY_LANE_CENTERS_METERS[best]) ? index : best
  ), 0)
}
