import { useMemo } from 'react'
import { Object3D } from 'three'

import { HIGHWAY_LANE_WIDTH, SCENE_SCALE } from './sceneCoordinates'
import {
  DEFAULT_PRESENTATION_ENVIRONMENT,
  type PresentationEnvironment,
} from './environmentPresets'
import { HighwayEnvironmentVariants3D } from './HighwayEnvironmentVariants3D'
import { PbrSurfaceMaterial } from './environmentMaterials'

export type SceneLayout = 'highway' | 'urban' | 'custom'

type Road3DProps = {
  layout?: SceneLayout
  environmentPreset?: PresentationEnvironment
  showInfrastructure?: boolean
}

function RoadStrip({ x, z, width, depth }: {
  x: number
  z: number
  width: number
  depth: number
}) {
  return (
    <mesh position={[x, -0.025, z]} receiveShadow>
      <boxGeometry args={[width, 0.1, depth]} />
      <PbrSurfaceMaterial surface="asphalt" repeat={[Math.max(1, width / 2.1), Math.max(1, depth / 2.1)]}
        roughness={0.94} metalness={0.015} normalScale={0.24} />
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
  const dashLength = 0.36
  const gap = 0.62
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
      <meshStandardMaterial color="#ecebe4" roughness={0.68} metalness={0.01} />
    </instancedMesh>
  )
}

function RumbleStrip({ length, z }: { length: number; z: number }) {
  const count = Math.ceil(length / 0.58)
  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      receiveShadow
      frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        for (let index = 0; index < count; index += 1) {
          transform.position.set(index * 0.58, 0.026, z)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }}
    >
      <boxGeometry args={[0.24, 0.009, 0.025]} />
      <meshStandardMaterial color="#9ca1a2" roughness={0.96} />
    </instancedMesh>
  )
}

function Guardrail({ length, z, side }: { length: number; z: number; side: -1 | 1 }) {
  const posts = useMemo(
    () => Array.from({ length: Math.ceil(length / 0.52) }, (_, index) => index * 0.52),
    [length],
  )
  return (
    <group>
      {[0.065, 0.105].map((height) => (
        <mesh key={height} position={[length / 2, height, z]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.035, 0.035]} />
          <meshStandardMaterial color="#a8afb2" roughness={0.4} metalness={0.82} />
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
            transform.position.set(x, 0.045, z + side * 0.015)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}
      >
        <boxGeometry args={[0.035, 0.12, 0.035]} />
        <meshStandardMaterial color="#7f898f" roughness={0.52} metalness={0.72} />
      </instancedMesh>
    </group>
  )
}

function RoadsideContext({ length, offset }: { length: number; offset: number }) {
  const reflectorCount = Math.floor(length / 1.65)
  const treeCount = Math.floor(length / 5.8)
  return (
    <group>
      {[-1, 1].map((side) => (
        <instancedMesh key={`reflectors-${side}`} args={[undefined, undefined, reflectorCount]}
          castShadow frustumCulled={false} onUpdate={(mesh) => {
            const transform = new Object3D()
            for (let index = 0; index < reflectorCount; index += 1) {
              transform.position.set(index * 1.65 + 0.7, 0.095, side * (offset + 0.32))
              transform.updateMatrix()
              mesh.setMatrixAt(index, transform.matrix)
            }
            mesh.instanceMatrix.needsUpdate = true
          }}>
          <boxGeometry args={[0.025, 0.17, 0.04]} />
          <meshStandardMaterial color="#e9eef0" roughness={0.68} />
        </instancedMesh>
      ))}
      {[-1].map((side) => (
        <group key={`trees-${side}`}>
          <instancedMesh args={[undefined, undefined, treeCount]} castShadow frustumCulled={false}
            onUpdate={(mesh) => {
              const transform = new Object3D()
              for (let index = 0; index < treeCount; index += 1) {
                const drift = ((index * 17) % 9) * 0.045
                transform.position.set(index * 5.8 + 1.8 + drift, 0.12,
                  side * (offset + 1.85 + drift))
                transform.scale.set(0.75 + index % 3 * 0.08, 1, 0.75 + index % 3 * 0.08)
                transform.updateMatrix()
                mesh.setMatrixAt(index, transform.matrix)
              }
              mesh.instanceMatrix.needsUpdate = true
            }}>
            <cylinderGeometry args={[0.026, 0.038, 0.24, 7]} />
            <meshStandardMaterial color="#65584a" roughness={0.95} />
          </instancedMesh>
          <instancedMesh args={[undefined, undefined, treeCount]} castShadow frustumCulled={false}
            onUpdate={(mesh) => {
              const transform = new Object3D()
              for (let index = 0; index < treeCount; index += 1) {
                const drift = ((index * 17) % 9) * 0.045
                transform.position.set(index * 5.8 + 1.8 + drift, 0.18, side * (offset + 1.85 + drift))
                transform.scale.set(0.28 + index % 3 * 0.035, 0.34 + index % 4 * 0.025, 0.28 + index % 3 * 0.035)
                transform.updateMatrix()
                mesh.setMatrixAt(index, transform.matrix)
              }
              mesh.instanceMatrix.needsUpdate = true
            }}>
            <icosahedronGeometry args={[0.72, 1]} />
            <meshStandardMaterial color="#48614e" roughness={0.98} flatShading />
          </instancedMesh>
        </group>
      ))}
    </group>
  )
}

function HighwayGantry({ x, width }: { x: number; width: number }) {
  return <group position={[x, 0, 0]}>
    {[-1, 1].map((side) => <mesh key={side} position={[0, 0.64, side * width / 2]}
      castShadow receiveShadow>
      <cylinderGeometry args={[0.025, 0.035, 1.28, 10]} />
      <meshStandardMaterial color="#798389" roughness={0.42} metalness={0.76} />
    </mesh>)}
    <mesh position={[0, 1.22, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.045, 0.055, width]} />
      <meshStandardMaterial color="#747f85" roughness={0.45} metalness={0.72} />
    </mesh>
    {[-0.5, 0.5].map((offset) => <group key={offset} position={[-0.035, 1.03, offset]}>
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.045, 0.36, 0.78]} />
        <meshStandardMaterial color="#1f6658" roughness={0.5} metalness={0.12} />
      </mesh>
      {[-0.09, 0.02, 0.13].map((y, index) => <mesh key={y}
        position={[-0.026, y, 0.08 - index * 0.06]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.008, 0.018, 0.48 - index * 0.08]} />
        <meshBasicMaterial color="#e8f6ed" toneMapped={false} />
      </mesh>)}
    </group>)}
  </group>
}

export function Road3D({ layout = 'highway',
  environmentPreset = DEFAULT_PRESENTATION_ENVIRONMENT,
  showInfrastructure = true }: Road3DProps) {
  const length = 5000 * SCENE_SCALE
  if (layout === 'urban') {
    const verticalXs = [1000, 2500, 4000].map((value) => value * SCENE_SCALE)
    const horizontalZ = 500 * SCENE_SCALE
    return (
      <group>
        <RoadStrip x={length / 2} z={horizontalZ} width={length} depth={0.34} />
        {verticalXs.map((x) => <RoadStrip key={x} x={x} z={10} width={0.34} depth={20}
          />)}
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
      <HighwayEnvironmentVariants3D environment={environmentPreset} length={length}
        showInfrastructure={showInfrastructure} />
      <mesh position={[length / 2, -0.075, 0]} receiveShadow>
        <boxGeometry args={[length, 0.14, roadDepth + 0.34]} />
        {environmentPreset === 'open_highway'
          ? <meshStandardMaterial color="#858b87" roughness={0.97} metalness={0.01} />
          : <PbrSurfaceMaterial surface="concrete" repeat={[Math.max(1, length / 2), 2]}
            color={environmentPreset === 'tunnel' ? '#71777a' : '#8f9391'} normalScale={0.18} />}
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
      {showInfrastructure && <><Guardrail length={length} z={-guardrailOffset} side={-1} />
        <Guardrail length={length} z={guardrailOffset} side={1} />
        <RoadsideContext length={length} offset={guardrailOffset} />
        {[62, 188, 326].map((x) => <HighwayGantry key={x} x={x}
          width={roadDepth + 0.65} />)}</>}
      <instancedMesh args={[undefined, undefined, Math.ceil(length / 12)]} receiveShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          for (let index = 0; index < Math.ceil(length / 12); index += 1) {
            transform.position.set(index * 12 + 4.5, 0.032, ((index * 7) % 5 - 2) * 0.12)
            transform.scale.set(0.8 + index % 3 * 0.22, 1, 0.35 + index % 2 * 0.2)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          }
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <boxGeometry args={[0.7, 0.006, 0.16]} />
        <meshStandardMaterial color="#2b3033" roughness={0.98} transparent opacity={0.3} />
      </instancedMesh>
    </group>
  )
}
