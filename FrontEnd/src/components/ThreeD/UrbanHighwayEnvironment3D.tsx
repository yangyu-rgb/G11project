import { useEffect, useMemo } from 'react'
import {
  CanvasTexture,
  Color,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { SCENE_SCALE } from './sceneCoordinates'

type BuildingSpec = {
  color: string
  position: [number, number, number]
  scale: [number, number, number]
}

const BUILDING_COLORS = ['#9ca6ad', '#aab1b5', '#7f8a91', '#b8b4aa', '#87939b'] as const
const FAR_BUILDING_COLORS = ['#82909a', '#75848f', '#94a0a7', '#6f7d87'] as const

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function buildingsFor(length: number, side: -1 | 1, far = false): BuildingSpec[] {
  const spacing = far ? 13.4 : 9.2
  const start = far ? 3.4 : 1.6
  const count = Math.ceil(length / spacing)
  const palette = far ? FAR_BUILDING_COLORS : BUILDING_COLORS
  return Array.from({ length: count }, (_, index) => {
    const seed = index + (side > 0 ? 131 : 19) + (far ? 503 : 0)
    const width = (far ? 3.6 : 2.2) + pseudoRandom(seed) * (far ? 3.3 : 2.4)
    const depth = (far ? 3.2 : 2.1) + pseudoRandom(seed + 1) * (far ? 4.1 : 2.2)
    const height = (far ? 3.2 : 1.6) + pseudoRandom(seed + 2) * (far ? 5.2 : 3.6)
    const setback = far ? 27 : 13.5
    const z = side * (setback + depth * 0.5 + pseudoRandom(seed + 3) * (far ? 8 : 4.5))
    return {
      color: palette[Math.floor(pseudoRandom(seed + 4) * palette.length)],
      position: [
        Math.min(length - width * 0.5, index * spacing + start + pseudoRandom(seed + 5) * 2.8),
        height * 0.5 - 0.04,
        z,
      ],
      scale: [width, height, depth],
    }
  })
}

function windowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create city facade texture')
  context.fillStyle = '#b8c0c4'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const lit = pseudoRandom(row * 31 + column * 7) > 0.78
      context.fillStyle = lit ? '#d8cda9' : '#40515c'
      context.fillRect(7 + column * 20, 7 + row * 16, 13, 9)
    }
  }
  context.fillStyle = 'rgba(236,240,241,0.38)'
  for (let column = 0; column < 7; column += 1) context.fillRect(column * 20, 0, 2, 256)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(1.5, 3)
  texture.needsUpdate = true
  return texture
}

function BuildingLayer({ specs, detailed }: { specs: BuildingSpec[]; detailed: boolean }) {
  const texture = useMemo(() => detailed ? windowTexture() : null, [detailed])
  useEffect(() => () => texture?.dispose(), [texture])
  return (
    <instancedMesh args={[undefined, undefined, specs.length]} castShadow={detailed} receiveShadow
      frustumCulled onUpdate={(mesh) => {
        const transform = new Object3D()
        specs.forEach((spec, index) => {
          transform.position.set(...spec.position)
          transform.scale.set(...spec.scale)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
          mesh.setColorAt(index, new Color(spec.color))
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial map={texture ?? undefined} roughness={detailed ? 0.72 : 0.9}
        metalness={detailed ? 0.08 : 0.02} color="#ffffff"
        emissive={detailed ? '#27343a' : '#35434b'} emissiveIntensity={detailed ? 0.13 : 0.18} />
    </instancedMesh>
  )
}

function RooftopLayer({ specs }: { specs: BuildingSpec[] }) {
  return (
    <instancedMesh args={[undefined, undefined, specs.length]} castShadow receiveShadow frustumCulled
      onUpdate={(mesh) => {
        const transform = new Object3D()
        specs.forEach((spec, index) => {
          transform.position.set(
            spec.position[0] + spec.scale[0] * 0.08,
            spec.scale[1] + 0.08,
            spec.position[2] - spec.scale[2] * 0.09,
          )
          transform.scale.set(spec.scale[0] * 0.28, 0.16, spec.scale[2] * 0.24)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        })
        mesh.instanceMatrix.needsUpdate = true
      }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#737d82" roughness={0.8} metalness={0.12} />
    </instancedMesh>
  )
}

function StreetLights({ length, z, side }: { length: number; z: number; side: -1 | 1 }) {
  const positions = useMemo(
    () => Array.from({ length: Math.ceil(length / 9.5) }, (_, index) => index * 9.5 + 2.8),
    [length],
  )
  return (
    <group>
      <instancedMesh args={[undefined, undefined, positions.length]} castShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          positions.forEach((x, index) => {
            transform.position.set(x, 0.34, z)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <cylinderGeometry args={[0.015, 0.025, 0.68, 8]} />
        <meshStandardMaterial color="#6e777c" roughness={0.48} metalness={0.72} />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, positions.length]} castShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          positions.forEach((x, index) => {
            transform.position.set(x, 0.675, z - side * 0.18)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <boxGeometry args={[0.03, 0.025, 0.38]} />
        <meshStandardMaterial color="#747d82" roughness={0.42} metalness={0.76} />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, positions.length]} frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          positions.forEach((x, index) => {
            transform.position.set(x, 0.655, z - side * 0.37)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <boxGeometry args={[0.13, 0.026, 0.065]} />
        <meshStandardMaterial color="#f0e5c7" emissive="#f4ddb0" emissiveIntensity={0.45}
          roughness={0.35} toneMapped />
      </instancedMesh>
    </group>
  )
}

function SoundBarrier({ length, z }: { length: number; z: number }) {
  const panelWidth = 0.86
  const count = Math.ceil(length / panelWidth)
  return (
    <group>
      <mesh position={[length / 2, 0.07, z]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.14, 0.11]} />
        <meshStandardMaterial color="#858d91" roughness={0.72} metalness={0.08} />
      </mesh>
      <instancedMesh args={[undefined, undefined, count]} castShadow receiveShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          for (let index = 0; index < count; index += 1) {
            transform.position.set(index * panelWidth + panelWidth / 2, 0.29, z)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          }
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <boxGeometry args={[panelWidth - 0.025, 0.37, 0.028]} />
        <meshPhysicalMaterial color="#839da8" roughness={0.17} metalness={0.04}
          transmission={0.35} thickness={0.08} transparent opacity={0.56} depthWrite={false} />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, count + 1]} castShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          for (let index = 0; index <= count; index += 1) {
            transform.position.set(index * panelWidth, 0.29, z)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          }
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <boxGeometry args={[0.025, 0.46, 0.045]} />
        <meshStandardMaterial color="#69757b" roughness={0.42} metalness={0.62} />
      </instancedMesh>
    </group>
  )
}

function ServiceRoad({ length, z }: { length: number; z: number }) {
  return (
    <group>
      <mesh position={[length / 2, -0.035, z]} receiveShadow>
        <boxGeometry args={[length, 0.075, 1.55]} />
        <meshStandardMaterial color="#353b3f" roughness={0.96} metalness={0.015} />
      </mesh>
      <mesh position={[length / 2, 0.006, z]} receiveShadow>
        <boxGeometry args={[length, 0.008, 0.016]} />
        <meshStandardMaterial color="#c3c7c5" roughness={0.82} />
      </mesh>
      {[z - 0.95, z + 0.95].map((curbZ) => (
        <mesh key={curbZ} position={[length / 2, 0.015, curbZ]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.055, 0.16]} />
          <meshStandardMaterial color="#9a9d9b" roughness={0.92} />
        </mesh>
      ))}
    </group>
  )
}

function BoulevardTrees({ length, z }: { length: number; z: number }) {
  const positions = useMemo(
    () => Array.from({ length: Math.ceil(length / 11.5) }, (_, index) => index * 11.5 + 4.2),
    [length],
  )
  return (
    <group>
      <instancedMesh args={[undefined, undefined, positions.length]} castShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          positions.forEach((x, index) => {
            transform.position.set(x, 0.18, z)
            transform.scale.setScalar(0.88 + index % 3 * 0.08)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <cylinderGeometry args={[0.035, 0.05, 0.36, 8]} />
        <meshStandardMaterial color="#66594a" roughness={0.98} />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, positions.length]} castShadow receiveShadow frustumCulled
        onUpdate={(mesh) => {
          const transform = new Object3D()
          positions.forEach((x, index) => {
            transform.position.set(x, 0.43, z)
            transform.scale.set(0.34 + index % 4 * 0.025, 0.42 + index % 3 * 0.035,
              0.34 + index % 4 * 0.025)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
            mesh.setColorAt(index, new Color(index % 2 ? '#46604d' : '#536c55'))
          })
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }}>
        <icosahedronGeometry args={[0.72, 2]} />
        <meshStandardMaterial color="#ffffff" roughness={0.98} />
      </instancedMesh>
    </group>
  )
}

function DirectionSign({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.025, 0.72, 8]} />
        <meshStandardMaterial color="#6c757a" roughness={0.45} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.065, 0.35, 0.78]} />
        <meshStandardMaterial color="#2e6b61" roughness={0.48} metalness={0.16} />
      </mesh>
      {[-0.09, 0.02, 0.13].map((y, index) => (
        <mesh key={y} position={[-0.034, 0.72 + y, -0.06 + index * 0.03]}
          rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.012, 0.017, 0.53 - index * 0.08]} />
          <meshBasicMaterial color="#e7f0e9" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export function UrbanHighwayEnvironment3D({ length }: { length: number }) {
  const nearBuildings = useMemo(
    () => [...buildingsFor(length, -1), ...buildingsFor(length, 1)],
    [length],
  )
  const farBuildings = useMemo(
    () => [...buildingsFor(length, -1, true), ...buildingsFor(length, 1, true)],
    [length],
  )
  const roadside = 2.55
  const serviceRoad = 5.35
  return (
    <group name="urban-highway-environment">
      <mesh position={[length / 2, -0.16, 0]} receiveShadow>
        <boxGeometry args={[length, 0.28, 72]} />
        <meshStandardMaterial color="#59675b" roughness={1} metalness={0} />
      </mesh>
      {[-3.1, 3.1].map((z) => (
        <mesh key={`landscape-${z}`} position={[length / 2, -0.005, z]} receiveShadow>
          <boxGeometry args={[length, 0.035, 2.3]} />
          <meshStandardMaterial color="#526b53" roughness={1} metalness={0} />
        </mesh>
      ))}
      {[-7.05, 7.05].map((z) => (
        <mesh key={`walk-${z}`} position={[length / 2, 0.004, z]} receiveShadow>
          <boxGeometry args={[length, 0.04, 1.25]} />
          <meshStandardMaterial color="#a3a5a0" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      <ServiceRoad length={length} z={-serviceRoad} />
      <ServiceRoad length={length} z={serviceRoad} />
      <BuildingLayer specs={farBuildings} detailed={false} />
      <BuildingLayer specs={nearBuildings} detailed />
      <RooftopLayer specs={nearBuildings} />
      <BoulevardTrees length={length} z={-7.75} />
      <BoulevardTrees length={length} z={7.75} />
      <StreetLights length={length} z={-roadside} side={-1} />
      <StreetLights length={length} z={roadside} side={1} />
      <SoundBarrier length={length} z={-1.28} />
      <DirectionSign x={54 * SCENE_SCALE} z={1.46} />
      <DirectionSign x={1920 * SCENE_SCALE} z={1.46} />
      <DirectionSign x={3820 * SCENE_SCALE} z={1.46} />
    </group>
  )
}
