import { useMemo } from 'react'
import { Object3D } from 'three'

import type { PresentationEnvironment } from './environmentPresets'

function InstancedBlocks({ positions, color, roughness = 0.88 }: {
  positions: Array<[number, number, number, number, number, number]>
  color: string
  roughness?: number
}) {
  return <instancedMesh args={[undefined, undefined, positions.length]} castShadow receiveShadow
    frustumCulled={false} onUpdate={(mesh) => {
      const transform = new Object3D()
      positions.forEach(([x, y, z, sx, sy, sz], index) => {
        transform.position.set(x, y, z)
        transform.scale.set(sx, sy, sz)
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={color} roughness={roughness} metalness={0.05} />
  </instancedMesh>
}

function OpenHighwayEnvironment({ length }: { length: number }) {
  const treePositions = useMemo(() => {
    const positions: Array<[number, number, number, number, number, number]> = []
    for (let x = 1.5, index = 0; x < length; x += 5.8, index += 1) {
      for (const side of [-1, 1] as const) {
        const drift = ((index * 13 + (side > 0 ? 5 : 0)) % 9) * 0.11
        positions.push([x + drift, 0.36, side * (3.25 + drift * 0.34), 0.55, 0.78, 0.55])
      }
    }
    return positions
  }, [length])
  const distantStructures = useMemo(() => Array.from({ length: Math.ceil(length / 20) }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1
    const position: [number, number, number, number, number, number] = [
      index * 20 + 7, 0.42, side * (8.2 + index % 3),
      4.8, 0.85 + index % 3 * 0.24, 2.4,
    ]
    return position
  }), [length])
  return <group>
    <mesh position={[length / 2, -0.18, 0]} receiveShadow>
      <boxGeometry args={[length + 24, 0.3, 32]} />
      <meshStandardMaterial color="#64745f" roughness={1} />
    </mesh>
    <InstancedBlocks positions={distantStructures} color="#81908d" />
    <instancedMesh args={[undefined, undefined, treePositions.length]} castShadow frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        treePositions.forEach(([x, y, z, sx, sy, sz], index) => {
          transform.position.set(x, y, z)
          transform.scale.set(sx, sy, sz)
          transform.rotation.y = index * 0.71
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        })
        mesh.instanceMatrix.needsUpdate = true
      }}>
      <icosahedronGeometry args={[0.58, 1]} />
      <meshStandardMaterial color="#43644c" roughness={0.96} flatShading />
    </instancedMesh>
    <mesh position={[length / 2, 0.02, -2.15]} receiveShadow>
      <boxGeometry args={[length, 0.04, 1.4]} />
      <meshStandardMaterial color="#526b4b" roughness={1} />
    </mesh>
    <mesh position={[length / 2, 0.02, 2.15]} receiveShadow>
      <boxGeometry args={[length, 0.04, 1.4]} />
      <meshStandardMaterial color="#526b4b" roughness={1} />
    </mesh>
  </group>
}

function ElevatedHighwayEnvironment({ length }: { length: number }) {
  const pillars = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = 2; x < length; x += 7.5) values.push([x, -0.72, 0, 0.72, 1.45, 0.72])
    return values
  }, [length])
  const buildings = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = -4, index = 0; x < length + 8; x += 6.2, index += 1) {
      for (const side of [-1, 1] as const) {
        const height = 2.4 + ((index * 7 + (side > 0 ? 3 : 0)) % 7) * 0.62
        const z = side * (5.6 + (index % 3) * 1.25)
        values.push([x + (side > 0 ? 1.8 : 0), height / 2 - 1.45, z, 3.5, height, 2.8])
      }
    }
    return values
  }, [length])
  const windows = useMemo(() => buildings.flatMap(([x, y, z, sx, sy]) => {
    const side = z > 0 ? 1 : -1
    return Array.from({ length: Math.max(1, Math.floor(sy / 0.7)) }, (_, floor) => {
      const position: [number, number, number, number, number, number] = [
        x, y - sy / 2 + 0.48 + floor * 0.68,
        z - side * (2.8 / 2 + 0.012), sx * 0.64, 0.12, 0.02,
      ]
      return position
    })
  }), [buildings])
  return <group>
    <mesh position={[length / 2, -1.55, 0]} receiveShadow>
      <boxGeometry args={[length + 24, 0.18, 36]} />
      <meshStandardMaterial color="#697477" roughness={0.98} />
    </mesh>
    <InstancedBlocks positions={buildings} color="#73808a" />
    <InstancedBlocks positions={windows} color="#b9d4dd" roughness={0.4} />
    <InstancedBlocks positions={pillars} color="#7c8588" />
    <mesh position={[length / 2, -0.25, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, 0.34, 3.55]} />
      <meshStandardMaterial color="#84898a" roughness={0.9} />
    </mesh>
    {[-1, 1].map((side) => <group key={side}>
      <mesh position={[length / 2, 0.52, side * 1.98]} receiveShadow>
        <boxGeometry args={[length, 0.86, 0.045]} />
        <meshPhysicalMaterial color="#96b6c1" transparent opacity={0.28} roughness={0.3}
          transmission={0.08} depthWrite={false} />
      </mesh>
      <mesh position={[length / 2, 0.11, side * 2.01]}>
        <boxGeometry args={[length, 0.08, 0.08]} />
        <meshStandardMaterial color="#78868b" metalness={0.4} roughness={0.55} />
      </mesh>
    </group>)}
  </group>
}

function TunnelHighwayEnvironment({ length }: { length: number }) {
  const ribs = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = 0; x < length; x += 3.2) {
      values.push([x, 1.75, -2.08, 0.1, 3.5, 0.12])
      values.push([x, 1.75, 2.08, 0.1, 3.5, 0.12])
      values.push([x, 3.46, 0, 0.1, 0.12, 4.2])
    }
    return values
  }, [length])
  const lights = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = 1; x < length; x += 2.2) {
      values.push([x, 3.3, -0.92, 0.72, 0.045, 0.08])
      values.push([x, 3.3, 0.92, 0.72, 0.045, 0.08])
    }
    return values
  }, [length])
  const emergencySigns = useMemo(() => Array.from({ length: Math.ceil(length / 18) }, (_, index) => {
    const position: [number, number, number, number, number, number] = [
      index * 18 + 8, 0.85, index % 2 ? -2.11 : 2.11, 0.52, 0.34, 0.035,
    ]
    return position
  }), [length])
  return <group>
    <mesh position={[length / 2, -0.22, 0]} receiveShadow>
      <boxGeometry args={[length + 4, 0.25, 5.5]} />
      <meshStandardMaterial color="#30383c" roughness={0.94} />
    </mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[length / 2, 0.58, side * 2.11]}
      castShadow receiveShadow>
      <boxGeometry args={[length, 1.16, 0.13]} />
      <meshStandardMaterial color="#697176" roughness={0.8} />
    </mesh>)}
    <mesh position={[length / 2, 3.54, 0]} receiveShadow>
      <boxGeometry args={[length, 0.16, 4.25]} />
      <meshStandardMaterial color="#3d4549" roughness={0.9} side={2} />
    </mesh>
    <InstancedBlocks positions={ribs} color="#626b70" roughness={0.68} />
    <instancedMesh args={[undefined, undefined, lights.length]} frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        lights.forEach(([x, y, z, sx, sy, sz], index) => {
          transform.position.set(x, y, z)
          transform.scale.set(sx, sy, sz)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        })
        mesh.instanceMatrix.needsUpdate = true
      }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#eaf8ff" emissive="#bfeaff" emissiveIntensity={3.4}
        roughness={0.25} toneMapped={false} />
    </instancedMesh>
    <instancedMesh args={[undefined, undefined, emergencySigns.length]} frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        emergencySigns.forEach(([x, y, z, sx, sy, sz], index) => {
          transform.position.set(x, y, z)
          transform.scale.set(sx, sy, sz)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        })
        mesh.instanceMatrix.needsUpdate = true
      }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#5ee3b2" emissive="#24b982" emissiveIntensity={1.7}
        roughness={0.45} toneMapped={false} />
    </instancedMesh>
  </group>
}

export function HighwayEnvironmentVariants3D({ environment, length }: {
  environment: PresentationEnvironment
  length: number
}) {
  if (environment === 'city_elevated') return <ElevatedHighwayEnvironment length={length} />
  if (environment === 'tunnel') return <TunnelHighwayEnvironment length={length} />
  return <OpenHighwayEnvironment length={length} />
}
