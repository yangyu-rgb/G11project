export type CameraControlMode = 'directed' | 'manual_follow' | 'returning'

export const CAMERA_RETURN_DELAY_MS = 6_000

export type CameraControlState = {
  mode: CameraControlMode
  resumeAtMs: number | null
}

export function beginManualCamera(): CameraControlState {
  return { mode: 'manual_follow', resumeAtMs: null }
}

export function endManualCamera(nowMs: number): CameraControlState {
  return { mode: 'manual_follow', resumeAtMs: nowMs + CAMERA_RETURN_DELAY_MS }
}

export function cameraStateAt(state: CameraControlState, nowMs: number): CameraControlState {
  if (state.mode === 'manual_follow' && state.resumeAtMs !== null && nowMs >= state.resumeAtMs) {
    return { mode: 'returning', resumeAtMs: null }
  }
  return state
}

export function cameraCountdownMs(state: CameraControlState, nowMs: number): number {
  return state.mode === 'manual_follow' && state.resumeAtMs !== null
    ? Math.max(0, state.resumeAtMs - nowMs) : 0
}
