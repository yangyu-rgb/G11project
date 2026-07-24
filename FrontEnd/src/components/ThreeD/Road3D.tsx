import { SCENE_SCALE } from './sceneCoordinates'

export type SceneLayout = 'highway' | 'urban' | 'custom'

type Road3DProps = {
  layout?: SceneLayout
}

function RoadStrip({ x, z, width, depth }: { x: number; z: number; width: number; depth: number }) {
  return (
    <mesh position={[x, -0.08, z]}>
      <boxGeometry args={[width, 0.12, depth]} />
      <meshStandardMaterial color="#172436" roughness={0.92} />
    </mesh>
  )
}

function LaneLine({ x, z, width, depth }: { x: number; z: number; width: number; depth: number }) {
  return (
    <mesh position={[x, 0.005, z]}>
      <boxGeometry args={[width, 0.015, depth]} />
      <meshBasicMaterial color="#cbd5e1" transparent opacity={0.72} />
    </mesh>
  )
}

export function Road3D({ layout = 'highway' }: Road3DProps) {
  const length = 5000 * SCENE_SCALE
  if (layout === 'urban') {
    const verticalXs = [1000, 2500, 4000].map((value) => value * SCENE_SCALE)
    const horizontalZ = 500 * SCENE_SCALE
    return (
      <group>
        <RoadStrip x={length / 2} z={horizontalZ} width={length} depth={0.34} />
        {verticalXs.map((x) => <RoadStrip key={x} x={x} z={10} width={0.34} depth={20} />)}
        {verticalXs.map((x) => (
          <mesh key={`junction-${x}`} position={[x, 0, horizontalZ]}>
            <boxGeometry args={[1.25, 0.025, 1.25]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} />
          </mesh>
        ))}
      </group>
    )
  }

  const roadCenter = -6.4 * SCENE_SCALE
  return (
    <group>
      <RoadStrip x={length / 2} z={roadCenter} width={length} depth={0.28} />
      {[-3.2, -6.4, -9.6].map((laneY) => (
        <LaneLine key={laneY} x={length / 2} z={laneY * SCENE_SCALE} width={length} depth={0.018} />
      ))}
    </group>
  )
}
