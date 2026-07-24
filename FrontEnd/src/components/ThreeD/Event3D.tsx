import { Html } from '@react-three/drei'

import type { SimulationEvent } from '../../types/simulation'
import { SCENE_SCALE, toScenePosition } from './sceneCoordinates'

type Event3DProps = {
  event: SimulationEvent
}

export function Event3D({ event }: Event3DProps) {
  const [x, , z] = toScenePosition(event.x, event.y)
  const radius = 300 * SCENE_SCALE

  return (
    <group position={[x, 0.02, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.13} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.3, 0.45, 1.4, 12]} />
        <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.8} />
      </mesh>
      <Html center position={[0, 1.8, 0]} className="scene-event-label">
        <strong>!</strong><span>{event.type}</span>
      </Html>
    </group>
  )
}
