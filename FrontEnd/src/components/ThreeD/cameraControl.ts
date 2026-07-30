export type CameraControlMode = 'directed' | 'free' | 'returning'

export type CameraControlState = {
  mode: CameraControlMode
}

export const CAMERA_TARGET_BOUNDS = {
  x: [0, 400],
  y: [0, 12],
  z: [-18, 18],
} as const

export function beginManualCamera(): CameraControlState {
  return { mode: 'free' }
}

export function endManualCamera(): CameraControlState {
  return { mode: 'free' }
}

export function requestDirectedCamera(): CameraControlState {
  return { mode: 'returning' }
}

export function settleDirectedCamera(): CameraControlState {
  return { mode: 'directed' }
}

export function clampCameraTarget(target: readonly number[]): [number, number, number] {
  return [
    Math.min(CAMERA_TARGET_BOUNDS.x[1], Math.max(CAMERA_TARGET_BOUNDS.x[0], target[0])),
    Math.min(CAMERA_TARGET_BOUNDS.y[1], Math.max(CAMERA_TARGET_BOUNDS.y[0], target[1])),
    Math.min(CAMERA_TARGET_BOUNDS.z[1], Math.max(CAMERA_TARGET_BOUNDS.z[0], target[2])),
  ]
}
