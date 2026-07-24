import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Group } from 'three'

import type { SimulationVehicle, VehicleStatus } from '../../types/simulation'
import { smoothstepProgress } from '../../utils/interpolation'
import {
  interpolateVehicle,
  VEHICLE_INTERPOLATION_DURATION_MS,
} from '../MapView/vehicleInterpolation'
import { toSceneHeading, toScenePosition } from './sceneCoordinates'

type Vehicle3DProps = {
  vehicle: SimulationVehicle
}

const STATUS_COLORS: Record<VehicleStatus, string> = {
  normal: '#3282f6',
  sending: '#10b981',
  receiving: '#f59e0b',
}

export function Vehicle3D({ vehicle }: Vehicle3DProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const target = toScenePosition(vehicle.x, vehicle.y)
  const targetHeading = toSceneHeading(vehicle.heading)
  const transition = useRef({ from: vehicle, to: vehicle, startedAt: Date.now() })

  useEffect(() => {
    const active = transition.current
    const progress = smoothstepProgress((Date.now() - active.startedAt) / VEHICLE_INTERPOLATION_DURATION_MS)
    transition.current = {
      from: interpolateVehicle(active.from, active.to, progress),
      to: vehicle,
      startedAt: Date.now(),
    }
  }, [vehicle])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const active = transition.current
    const progress = smoothstepProgress((Date.now() - active.startedAt) / VEHICLE_INTERPOLATION_DURATION_MS)
    const rendered = interpolateVehicle(active.from, active.to, progress)
    const position = toScenePosition(rendered.x, rendered.y)
    group.position.x = position[0]
    group.position.z = position[2]
    group.rotation.y = toSceneHeading(rendered.heading)
  })

  return (
    <group
      ref={groupRef}
      position={target}
      rotation={[0, targetHeading, 0]}
      onPointerEnter={(event) => { event.stopPropagation(); setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
    >
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[0.92, 0.34, 0.44]} />
        <meshStandardMaterial color={STATUS_COLORS[vehicle.status]} roughness={0.38} metalness={0.18} />
      </mesh>
      <mesh position={[0.08, 0.47, 0]}>
        <boxGeometry args={[0.42, 0.18, 0.38]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.25} metalness={0.1} />
      </mesh>
      {hovered && (
        <Html center position={[0, 1.15, 0]} className="scene-tooltip">
          <strong>{vehicle.id}</strong>
          <span>{(Math.hypot(vehicle.vx, vehicle.vy) * 3.6).toFixed(1)} km/h</span>
        </Html>
      )}
    </group>
  )
}
