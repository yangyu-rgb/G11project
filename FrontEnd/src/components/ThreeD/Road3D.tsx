import { useMemo } from 'react'
import { Object3D } from 'three'

import { HIGHWAY_LANE_WIDTH, SCENE_SCALE } from './sceneCoordinates'

export type SceneLayout = 'highway' | 'urban' | 'custom'

type Road3DProps = {
  layout?: SceneLayout
}

function RoadStrip({ x, z, width, depth }: { x: number; z: number; width: number; depth: number }) {
  return (
    <mesh position={[x, -0.025, z]} receiveShadow>
      <boxGeometry args={[width, 0.1, depth]} />
      <meshStandardMaterial color="#252a30" roughness={0.91} metalness={0.04} />
    </mesh>
  )
}

function LaneLine({ x, z, width, depth, color = '#e9edf0' }: {
  x: number
  z: number
  width: number
  depth: number
  color?: string
}) {
  return (
    <mesh position={[x, 0.031, z]} receiveShadow>
      <boxGeometry args={[width, 0.012, depth]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.01} />
    </mesh>
  )
}

function DashedLaneLine({ length, z }: { length: number; z: number }) {
  const dashLength = 1.15
  const gap = 0.85
  const count = Math.ceil(length / (dashLength + gap))
  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      receiveShadow
      frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        for (let index = 0; index < count; index += 1) {
          transform.position.set(index * (dashLength + gap) + dashLength / 2, 0.031, z)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }}
    >
      <boxGeometry args={[dashLength, 0.012, 0.022]} />
      <meshStandardMaterial color="#e9edf0" roughness={0.72} metalness={0.01} />
    </instancedMesh>
  )
}

function RumbleStrip({ length, z }: { length: number; z: number }) {
  const count = Math.ceil(length / 0.7)
  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      receiveShadow
      frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        for (let index = 0; index < count; index += 1) {
          transform.position.set(index * 0.7, 0.026, z)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }}
    >
      <boxGeometry args={[0.34, 0.009, 0.028]} />
      <meshStandardMaterial color="#b4b9bc" roughness={0.94} />
    </instancedMesh>
  )
}

function Guardrail({ length, z, side }: { length: number; z: number; side: -1 | 1 }) {
  const posts = useMemo(() => Array.from({ length: Math.ceil(length / 5.5) }, (_, index) => index * 5.5), [length])
  return (
    <group>
      {[0.17, 0.28].map((height) => (
        <mesh key={height} position={[length / 2, height, z]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.055, 0.045]} />
          <meshStandardMaterial color="#aab2b8" roughness={0.48} metalness={0.78} />
        </mesh>
      ))}
      <instancedMesh
        args={[undefined, undefined, posts.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onUpdate={(mesh) => {
          const transform = new Object3D()
          posts.forEach((x, index) => {
            transform.position.set(x, 0.1, z + side * 0.018)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}
      >
        <boxGeometry args={[0.055, 0.34, 0.055]} />
        <meshStandardMaterial color="#7f898f" roughness={0.52} metalness={0.72} />
      </instancedMesh>
    </group>
  )
}

function RoadsideContext({ length, offset }: { length: number; offset: number }) {
  const reflectorCount = Math.floor(length / 7.5)
  const treeCount = Math.floor(length / 15)
  return (
    <group>
      {[-1, 1].map((side) => (
        <instancedMesh key={`reflectors-${side}`} args={[undefined, undefined, reflectorCount]}
          castShadow frustumCulled={false} onUpdate={(mesh) => {
            const transform = new Object3D()
            for (let index = 0; index < reflectorCount; index += 1) {
              transform.position.set(index * 7.5 + 2, 0.23, side * (offset + 0.42))
              transform.updateMatrix()
              mesh.setMatrixAt(index, transform.matrix)
            }
            mesh.instanceMatrix.needsUpdate = true
          }}>
          <boxGeometry args={[0.055, 0.42, 0.075]} />
          <meshStandardMaterial color="#e9eef0" roughness={0.68} />
        </instancedMesh>
      ))}
      {[-1].map((side) => (
        <group key={`trees-${side}`}>
          <instancedMesh args={[undefined, undefined, treeCount]} castShadow frustumCulled={false}
            onUpdate={(mesh) => {
              const transform = new Object3D()
              for (let index = 0; index < treeCount; index += 1) {
                const drift = ((index * 17) % 9) * 0.16
                transform.position.set(index * 15 + 5 + drift, 0.3, side * (offset + 2.4 + drift))
                transform.scale.set(0.62 + index % 3 * 0.1, 0.46 + index % 4 * 0.06, 0.62 + index % 3 * 0.1)
                transform.updateMatrix()
                mesh.setMatrixAt(index, transform.matrix)
              }
              mesh.instanceMatrix.needsUpdate = true
            }}>
            <dodecahedronGeometry args={[0.68, 1]} />
            <meshStandardMaterial color="#405947" roughness={1} flatShading />
          </instancedMesh>
        </group>
      ))}
      <group position={[58, 0, -(offset + 1.1)]}>
        {Array.from({ length: 16 }, (_, index) => (
          <mesh key={index} position={[index * 3.2, 0.66, 0]} castShadow receiveShadow>
            <boxGeometry args={[3.08, 1.28, 0.085]} />
            <meshPhysicalMaterial color={index % 2 ? '#86949a' : '#93a0a5'} roughness={0.5}
              metalness={0.35} transparent opacity={0.84} />
          </mesh>
        ))}
      </group>
    </group>
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

  const laneDepth = HIGHWAY_LANE_WIDTH * 3
  const shoulderDepth = 0.17
  const roadDepth = laneDepth + shoulderDepth * 2
  const outerBoundary = laneDepth / 2
  const guardrailOffset = roadDepth / 2 + 0.14
  return (
    <group>
      <mesh position={[length / 2, -0.22, 0]} receiveShadow>
        <boxGeometry args={[length, 0.34, 46]} />
        <meshStandardMaterial color="#687764" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[length / 2, -0.075, 0]} receiveShadow>
        <boxGeometry args={[length, 0.14, roadDepth + 0.34]} />
        <meshStandardMaterial color="#777b7b" roughness={0.98} metalness={0.01} />
      </mesh>
      <RoadStrip x={length / 2} z={0} width={length} depth={roadDepth} />
      {[-outerBoundary, outerBoundary].map((z) => (
        <LaneLine key={`edge-${z}`} x={length / 2} z={z} width={length} depth={0.032} />
      ))}
      {[-HIGHWAY_LANE_WIDTH / 2, HIGHWAY_LANE_WIDTH / 2].map((z) => (
        <group key={`divider-${z}`}><DashedLaneLine length={length} z={z} /></group>
      ))}
      {[-outerBoundary - shoulderDepth * 0.55, outerBoundary + shoulderDepth * 0.55].map((z) => (
        <group key={`rumble-${z}`}><RumbleStrip length={length} z={z} /></group>
      ))}
      <Guardrail length={length} z={-guardrailOffset} side={-1} />
      <Guardrail length={length} z={guardrailOffset} side={1} />
      <RoadsideContext length={length} offset={guardrailOffset} />
    </group>
  )
}
