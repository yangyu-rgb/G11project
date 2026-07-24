export const SCENE_SCALE = 0.02

export function toScenePosition(x: number, y: number): [number, number, number] {
  return [x * SCENE_SCALE, 0, y * SCENE_SCALE]
}

export function toSceneHeading(heading: number): number {
  return ((heading - 90) * Math.PI) / 180
}
