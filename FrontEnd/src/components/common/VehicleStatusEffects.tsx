import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

import { VEHICLE_STATUS_COLORS } from '../../config/vehicleStatus'
import { animationEngine, type AnimationChannel } from '../../engine/AnimationEngine'
import type { VehicleStatus } from '../../types/simulation'

type VehicleStatusRing3DProps = {
  vehicleId: string
  channel: AnimationChannel
  status: VehicleStatus
}

export function VehicleStatusRing3D({ vehicleId, channel, status }: VehicleStatusRing3DProps) {
  const ring = useRef<Mesh>(null)
  useFrame(() => {
    const mesh = ring.current
    if (!mesh) return
    const frame = animationEngine.getSnapshot(channel)
    const phase = ((frame?.animationTimeMs ?? 0) % 1000) / 1000
    const outward = status === 'sending' ? phase : 1 - phase
    const scale = status === 'normal' ? 0 : 0.7 + outward * 1.25
    mesh.scale.setScalar(scale)
    mesh.visible = status !== 'normal' && animationEngine.getVehicle(channel, vehicleId) !== null
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    material.opacity = status === 'sending' ? 0.75 * (1 - phase) : 0.65 * phase
  })
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
      <ringGeometry args={[0.56, 0.68, 32]} />
      <meshBasicMaterial color={VEHICLE_STATUS_COLORS[status]} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  )
}
