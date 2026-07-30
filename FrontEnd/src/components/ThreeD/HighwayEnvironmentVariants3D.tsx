import { useMemo } from 'react'
import { Color, DoubleSide, Object3D } from 'three'

import type { PresentationEnvironment } from './environmentPresets'
import { PbrSurfaceMaterial } from './environmentMaterials'
import { UrbanHighwayEnvironment3D } from './UrbanHighwayEnvironment3D'

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

function InstancedEllipsoids({ positions, color }: {
  positions: Array<[number, number, number, number, number, number]>
  color: string
}) {
  return <instancedMesh args={[undefined, undefined, positions.length]} receiveShadow
    frustumCulled={false} onUpdate={(mesh) => {
      const transform = new Object3D()
      positions.forEach(([x, y, z, sx, sy, sz], index) => {
        transform.position.set(x, y, z)
        transform.scale.set(sx, sy, sz)
        transform.rotation.y = index * 0.31
        transform.updateMatrix()
        mesh.setMatrixAt(index, transform.matrix)
        mesh.setColorAt(index, new Color(index % 3 === 0 ? '#647368'
          : index % 3 === 1 ? '#728071' : '#596b62'))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }}>
    <sphereGeometry args={[1, 28, 14]} />
    <meshStandardMaterial color={color} roughness={1} />
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
  const hills = useMemo(() => Array.from({ length: Math.ceil(length / 24) }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1
    const position: [number, number, number, number, number, number] = [
      index * 24 + 2, -0.85 + index % 3 * 0.08, side * (13 + index % 4 * 1.8),
      6 + index % 4 * 1.1, 2.1 + index % 3 * 0.45, 5.5 + index % 2 * 1.6,
    ]
    return position
  }), [length])
  return <group>
    <mesh position={[length / 2, -0.18, 0]} receiveShadow>
      <boxGeometry args={[length + 24, 0.3, 46]} />
      <PbrSurfaceMaterial surface="grass" repeat={[Math.max(8, length / 5), 16]}
        color="#778771" roughness={1} normalScale={0.38} />
    </mesh>
    <InstancedEllipsoids positions={hills} color="#647368" />
    <InstancedBlocks positions={treePositions.map(([x, , z, sx]) => (
      [x, 0.17, z, Math.max(0.09, sx * 0.18), 0.48, Math.max(0.09, sx * 0.18)]
    ))} color="#554b3f" roughness={0.96} />
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
    <instancedMesh args={[undefined, undefined, treePositions.length]} castShadow frustumCulled={false}
      onUpdate={(mesh) => {
        const transform = new Object3D()
        treePositions.forEach(([x, y, z, sx, sy, sz], index) => {
          transform.position.set(x + (index % 2 ? 0.08 : -0.06), y + 0.27,
            z + (index % 3 - 1) * 0.07)
          transform.scale.set(sx * 0.68, sy * 0.58, sz * 0.68)
          transform.rotation.y = index * 0.47
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
          mesh.setColorAt(index, new Color(index % 2 ? '#4b7252' : '#395f46'))
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}>
      <dodecahedronGeometry args={[0.54, 1]} />
      <meshStandardMaterial color="#ffffff" roughness={0.98} />
    </instancedMesh>
    <mesh position={[length / 2, 0.02, -2.15]} receiveShadow>
      <boxGeometry args={[length, 0.04, 1.4]} />
      <meshStandardMaterial color="#526b4b" roughness={1} />
    </mesh>
    <mesh position={[length / 2, 0.02, 2.15]} receiveShadow>
      <boxGeometry args={[length, 0.04, 1.4]} />
      <meshStandardMaterial color="#526b4b" roughness={1} />
    </mesh>
    {[-2.52, 2.52].map((z) => <mesh key={`drain-${z}`} position={[length / 2, -0.015, z]}
      receiveShadow rotation={[0, 0, z < 0 ? -0.04 : 0.04]}>
      <boxGeometry args={[length, 0.055, 0.32]} />
      <meshStandardMaterial color="#7f8580" roughness={0.94} metalness={0.02} />
    </mesh>)}
  </group>
}

function ElevatedHighwayEnvironment({ length, showInfrastructure }: {
  length: number
  showInfrastructure: boolean
}) {
  const pillars = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = 2; x < length; x += 7.5) values.push([x, -0.72, 0, 0.72, 1.45, 0.72])
    return values
  }, [length])
  return <group>
    <mesh position={[length / 2, -1.55, 0]} receiveShadow>
      <boxGeometry args={[length + 24, 0.18, 36]} />
      <PbrSurfaceMaterial surface="concrete" repeat={[Math.max(8, length / 3), 18]}
        color="#727b7d" normalScale={0.24} />
    </mesh>
    <group position={[0, -1.38, 0]}><UrbanHighwayEnvironment3D length={length} /></group>
    <InstancedBlocks positions={pillars} color="#7c8588" />
    <mesh position={[length / 2, -0.25, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, 0.34, 3.55]} />
      <meshStandardMaterial color="#84898a" roughness={0.9} />
    </mesh>
    {showInfrastructure && [-1, 1].map((side) => <group key={side}>
      <mesh position={[length / 2, 0.52, side * 1.98]} receiveShadow>
        <boxGeometry args={[length, 0.86, 0.045]} />
        <meshPhysicalMaterial color="#96b6c1" transparent opacity={0.28} roughness={0.3}
          transmission={0.08} depthWrite={false} />
      </mesh>
      <mesh position={[length / 2, -0.06, side * 1.92]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.22, 0.22]} />
        <PbrSurfaceMaterial surface="concrete" repeat={[Math.max(4, length / 2), 1]}
          color="#858b8b" normalScale={0.18} />
      </mesh>
      <mesh position={[length / 2, 0.11, side * 2.01]}>
        <boxGeometry args={[length, 0.08, 0.08]} />
        <meshStandardMaterial color="#78868b" metalness={0.4} roughness={0.55} />
      </mesh>
    </group>)}
  </group>
}

function TunnelHighwayEnvironment({ length, showInfrastructure }: {
  length: number
  showInfrastructure: boolean
}) {
  const ribs = useMemo(() => {
    const values: Array<[number, number, number, number, number, number]> = []
    for (let x = 0; x < length; x += 3.2) {
      values.push([x, 0.75, -2.08, 0.1, 1.5, 0.12])
      values.push([x, 0.75, 2.08, 0.1, 1.5, 0.12])
    }
    return values
  }, [length])
  const archRibCount = Math.ceil(length / 3.2)
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
  const emergencyCabinets = useMemo(() => Array.from({ length: Math.ceil(length / 26) }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1
    const position: [number, number, number, number, number, number] = [
      index * 26 + 12, 0.72, side * 2.03, 0.55, 0.78, 0.08,
    ]
    return position
  }), [length])
  return <group>
    <mesh position={[length / 2, -0.22, 0]} receiveShadow>
      <boxGeometry args={[length + 4, 0.25, 5.5]} />
      <PbrSurfaceMaterial surface="concrete" repeat={[Math.max(4, length / 2), 3]}
        color="#485054" normalScale={0.24} />
    </mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[length / 2, 0.58, side * 2.11]}
      castShadow receiveShadow>
      <boxGeometry args={[length, 1.16, 0.13]} />
      <PbrSurfaceMaterial surface="concrete" repeat={[Math.max(4, length / 2), 2]}
        color="#777e81" normalScale={0.22} />
    </mesh>)}
    <mesh position={[length / 2, 1.45, 0]} rotation={[0, 0, Math.PI / 2]}
      castShadow receiveShadow>
      <cylinderGeometry args={[2.5, 2.5, length, 32, 1, true, 0, Math.PI]} />
      <meshStandardMaterial color="#596267" roughness={0.88} metalness={0.03}
        side={DoubleSide} transparent opacity={0.58} depthWrite={false} />
    </mesh>
    <InstancedBlocks positions={ribs} color="#626b70" roughness={0.68} />
    <instancedMesh args={[undefined, undefined, archRibCount]} castShadow receiveShadow
      frustumCulled={false} onUpdate={(mesh) => {
        const transform = new Object3D()
        for (let index = 0; index < archRibCount; index += 1) {
          transform.position.set(index * 3.2, 1.45, 0)
          transform.rotation.set(0, Math.PI / 2, 0)
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }}>
      <torusGeometry args={[2.5, 0.055, 6, 32, Math.PI]} />
      <meshStandardMaterial color="#7c878c" roughness={0.58} metalness={0.22} />
    </instancedMesh>
    {showInfrastructure && <InstancedBlocks positions={emergencyCabinets}
      color="#b43b35" roughness={0.54} />}
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
    {showInfrastructure && <instancedMesh args={[undefined, undefined, emergencySigns.length]} frustumCulled={false}
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
    </instancedMesh>}
    {[-1.91, 1.91].map((z) => <mesh key={`tunnel-reflector-${z}`}
      position={[length / 2, 0.2, z]}>
      <boxGeometry args={[length, 0.035, 0.025]} />
      <meshStandardMaterial color="#f5d56d" emissive="#d9a91f" emissiveIntensity={0.75}
        roughness={0.4} toneMapped={false} />
    </mesh>)}
  </group>
}

export function HighwayEnvironmentVariants3D({ environment, length, showInfrastructure = true }: {
  environment: PresentationEnvironment
  length: number
  showInfrastructure?: boolean
}) {
  if (environment === 'city_elevated') return <ElevatedHighwayEnvironment length={length}
    showInfrastructure={showInfrastructure} />
  if (environment === 'tunnel') return <TunnelHighwayEnvironment length={length}
    showInfrastructure={showInfrastructure} />
  return <OpenHighwayEnvironment length={length} />
}
