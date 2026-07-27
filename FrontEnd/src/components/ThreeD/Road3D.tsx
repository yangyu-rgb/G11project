import { HIGHWAY_LANE_WIDTH, SCENE_SCALE } from './sceneCoordinates'

export type SceneLayout = 'highway' | 'urban' | 'custom'

type Road3DProps = {
  layout?: SceneLayout
}

function RoadStrip({ x, z, width, depth }: { x: number; z: number; width: number; depth: number }) {
  return (
    <mesh position={[x, -0.035, z]} receiveShadow>
      <boxGeometry args={[width, 0.12, depth]} />
      <meshStandardMaterial color="#20252b" roughness={0.94} metalness={0.03} />
    </mesh>
  )
}

function LaneLine({ x, z, width, depth }: { x: number; z: number; width: number; depth: number }) {
  return (
    <mesh position={[x, 0.005, z]}>
      <boxGeometry args={[width, 0.015, depth]} />
      <meshStandardMaterial color="#f1f5f9" roughness={0.58} metalness={0.04} />
    </mesh>
  )
}

function DashedLaneLine({ length, z }: { length: number; z: number }) {
  const dashLength = 1.2
  const gap = 0.8
  const count = Math.ceil(length / (dashLength + gap))
  return Array.from({ length: count }, (_, index) => {
    const start = index * (dashLength + gap)
    const width = Math.min(dashLength, length - start)
    if (width <= 0) return null
    return <LaneLine key={`${z}-${index}`} x={start + width / 2} z={z} width={width} depth={0.025} />
  })
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

  const roadDepth = HIGHWAY_LANE_WIDTH * 3 + 0.22
  const outerBoundary = HIGHWAY_LANE_WIDTH * 1.5
  return (
    <group>
      <mesh position={[length / 2, -0.13, 0]} receiveShadow>
        <boxGeometry args={[length, 0.12, 32]} />
        <meshStandardMaterial color="#637660" roughness={1} metalness={0} />
      </mesh>
      <RoadStrip x={length / 2} z={0} width={length} depth={roadDepth} />
      {[-outerBoundary, outerBoundary].map((z) => (
        <LaneLine key={`edge-${z}`} x={length / 2} z={z} width={length} depth={0.035} />
      ))}
      {[-HIGHWAY_LANE_WIDTH / 2, HIGHWAY_LANE_WIDTH / 2].map((z) => (
        <group key={`divider-${z}`}><DashedLaneLine length={length} z={z} /></group>
      ))}
      {[-outerBoundary - 0.18, outerBoundary + 0.18].map((z) => (
        <mesh key={`barrier-${z}`} position={[length / 2, 0.13, z]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.22, 0.07]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.66} metalness={0.72} />
        </mesh>
      ))}
    </group>
  )
}
