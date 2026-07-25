import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationEvent, SimulationVehicle } from '../../types/simulation'
import { SCENE_SCALE, toScenePosition } from '../ThreeD/sceneCoordinates'

export function RadarScanEffect3D({ events, vehicles, candidateIds = [], animationChannel = 'single', active = true }: {
  events: SimulationEvent[]
  vehicles: SimulationVehicle[]
  candidateIds?: string[]
  animationChannel?: AnimationChannel
  active?: boolean
}) {
  const { animation: animationEngine } = useAnimationRuntime()
  const sweep = useRef<Mesh>(null)
  const startedAt = useRef(animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0)
  const event = events[0]
  useFrame(() => {
    if (!sweep.current || !event) return
    const now = animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0
    const age = now - startedAt.current
    sweep.current.rotation.z = -(age / 1500) * Math.PI * 2
    sweep.current.visible = age <= (candidateIds.length > 5 ? 3000 : 1500)
  })
  if (!active || !event) return null
  const [x, , z] = toScenePosition(event.x, event.y)
  return (
    <group position={[x, 0.1, z]}>
      <mesh ref={sweep} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[300 * SCENE_SCALE, 48, 0, Math.PI / 3]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {vehicles.filter((vehicle) => candidateIds.includes(vehicle.id)).map((vehicle) => {
        const [vehicleX, , vehicleZ] = toScenePosition(vehicle.x - event.x, vehicle.y - event.y)
        return <mesh key={vehicle.id} position={[vehicleX, 0.08, vehicleZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.54, 24]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      })}
    </group>
  )
}
