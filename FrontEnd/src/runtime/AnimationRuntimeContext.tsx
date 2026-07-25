/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'

import { AnimationEngine } from '../engine/AnimationEngine'
import { CameraController } from '../engine/CameraController'

export type AnimationRuntime = {
  animation: AnimationEngine
  camera: CameraController
}

export function createAnimationRuntime(): AnimationRuntime {
  return {
    animation: new AnimationEngine(),
    camera: new CameraController(),
  }
}

const defaultRuntime = createAnimationRuntime()
const AnimationRuntimeContext = createContext<AnimationRuntime | null>(null)

export function AnimationRuntimeProvider({ children, runtime = defaultRuntime }: {
  children: ReactNode
  runtime?: AnimationRuntime
}) {
  return (
    <AnimationRuntimeContext.Provider value={runtime}>
      {children}
    </AnimationRuntimeContext.Provider>
  )
}

export function useAnimationRuntime(): AnimationRuntime {
  const runtime = useContext(AnimationRuntimeContext)
  if (!runtime) throw new Error('AnimationRuntimeProvider is required')
  return runtime
}
