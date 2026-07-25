import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { easeOutCubic } from '../../engine/Interpolator'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationEvent } from '../../types/simulation'
import { SCENE_SCALE, toScenePosition } from '../ThreeD/sceneCoordinates'

function Shockwave3DItem({ event, animationChannel }: { event: SimulationEvent; animationChannel: AnimationChannel }) {
  const { animation: animationEngine } = useAnimationRuntime()
  const rings = useRef<Array<Mesh | null>>([])
  const startedAt = useRef(animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0)
  const [x, , z] = toScenePosition(event.x, event.y)
  useFrame(() => {
    const now = animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0
    const age = now - startedAt.current
    rings.current.forEach((ring, index) => {
      if (!ring) return
      const progress = Math.min(1, Math.max(0, (age - index * 300) / 1500))
      const material = Array.isArray(ring.material) ? ring.material[0] : ring.material
      ring.visible = progress > 0 && progress < 1
      ring.scale.setScalar(easeOutCubic(progress) * 300 * SCENE_SCALE)
      material.opacity = 0.8 * (1 - progress)
    })
  })
  return <group position={[x, 0.08, z]}>{[0, 1, 2].map((index) => (
    <mesh key={index} ref={(node) => { rings.current[index] = node }} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.94, 1, 48]} />
      <meshBasicMaterial color="#fb6340" transparent opacity={0.8} depthWrite={false} />
    </mesh>
  ))}</group>
}

export function ShockwaveEffect3D({ events, animationChannel = 'single', active = true }: {
  events: SimulationEvent[]
  animationChannel?: AnimationChannel
  active?: boolean
}) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!active || reduced) return null
  return events.map((event) => <Shockwave3DItem key={`${event.id}:${event.timestamp}`} event={event} animationChannel={animationChannel} />)
}
