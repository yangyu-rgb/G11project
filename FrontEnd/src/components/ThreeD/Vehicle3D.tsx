import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Group, MeshStandardMaterial } from 'three'

import { VEHICLE_STATUS_COLORS } from '../../config/vehicleStatus'
import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationVehicle, VehicleStatus } from '../../types/simulation'
import { VehicleStatusRing3D } from '../common/VehicleStatusEffects'
import { toSceneHeading, toScenePosition } from './sceneCoordinates'

type Vehicle3DProps = {
  vehicle: SimulationVehicle
  animationChannel?: AnimationChannel
}

const STATUS_COLORS: Record<VehicleStatus, string> = {
  normal: VEHICLE_STATUS_COLORS.normal,
  sending: VEHICLE_STATUS_COLORS.sending,
  receiving: VEHICLE_STATUS_COLORS.receiving,
}

export function Vehicle3D({ vehicle, animationChannel = 'single' }: Vehicle3DProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const groupRef = useRef<Group>(null)
  const bodyMaterial = useRef<MeshStandardMaterial>(null)
  const [hovered, setHovered] = useState(false)
  const target = toScenePosition(vehicle.x, vehicle.y)
  const targetHeading = toSceneHeading(vehicle.heading)

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const rendered = animationEngine.getVehicle(animationChannel, vehicle.id) ?? { ...vehicle, pitch: 0, motion: 'cruising' as const }
    const position = toScenePosition(rendered.x, rendered.y)
    group.position.x = position[0]
    group.position.z = position[2]
    group.rotation.y = toSceneHeading(rendered.heading)
    group.rotation.x = (-rendered.pitch * Math.PI) / 180
    const material = bodyMaterial.current
    if (material) {
      const color = rendered.motion === 'braking' ? VEHICLE_STATUS_COLORS.braking : STATUS_COLORS[rendered.status]
      material.color.set(color)
      material.emissive.set(color)
      material.emissiveIntensity = rendered.status === 'normal' ? 0.12 : 0.55
    }
  })

  return (
    <group
      ref={groupRef}
      position={target}
      rotation={[0, targetHeading, 0]}
      onPointerEnter={(event) => { event.stopPropagation(); setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
    >
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[1.08, 0.32, 0.48]} />
        <meshStandardMaterial ref={bodyMaterial} color={STATUS_COLORS[vehicle.status]} roughness={0.3} metalness={0.35} />
      </mesh>
      <mesh position={[-0.04, 0.5, 0]}>
        <boxGeometry args={[0.52, 0.2, 0.4]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.25} metalness={0.1} />
      </mesh>
      {[-0.34, 0.34].flatMap((x) => [-0.29, 0.29].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.16, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.1, 12]} />
          <meshStandardMaterial color="#020617" roughness={0.8} />
        </mesh>
      )))}
      <VehicleStatusRing3D vehicleId={vehicle.id} channel={animationChannel} status={vehicle.status} />
      {hovered && (
        <Html center position={[0, 1.15, 0]} className="scene-tooltip">
          <strong>{vehicle.id}</strong>
          <span>{(Math.hypot(vehicle.vx, vehicle.vy) * 3.6).toFixed(1)} km/h</span>
        </Html>
      )}
    </group>
  )
}
