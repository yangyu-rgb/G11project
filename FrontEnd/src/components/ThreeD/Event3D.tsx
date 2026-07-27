import type { SimulationEvent } from '../../types/simulation'
import type { SceneLayout } from './Road3D'
import { HIGHWAY_LANE_WIDTH, SCENE_SCALE, toScenePosition } from './sceneCoordinates'

type Event3DProps = {
  event: SimulationEvent
  layout?: SceneLayout
}

export function Event3D({ event, layout = 'custom' }: Event3DProps) {
  const [x, , z] = toScenePosition(event.x, event.y, layout)
  const radius = 300 * SCENE_SCALE

  return (
    <group position={[x, 0.02, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        {layout === 'highway'
          ? <planeGeometry args={[radius * 2, HIGHWAY_LANE_WIDTH * 3]} />
          : <circleGeometry args={[radius, 48]} />}
        <meshBasicMaterial color="#ef4444" transparent opacity={0.13} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.09, 0.2, 16]} />
        <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.8} />
      </mesh>
    </group>
  )
}
