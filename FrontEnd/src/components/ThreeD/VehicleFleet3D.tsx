import type { ThreeEvent } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Object3D,
} from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import type { AnimatedVehicle } from '../../engine/Interpolator'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationVehicle } from '../../types/simulation'
import type { PresentationStage } from '../Presentation/presentationTimeline'
import {
  HIGHWAY_LANE_CENTERS_METERS,
  HIGHWAY_VEHICLE_LENGTH,
  HIGHWAY_VEHICLE_WIDTH,
  nearestHighwayLaneIndex,
  SCENE_SCALE,
  toSceneHeading,
  toScenePosition,
} from './sceneCoordinates'
import { enforceHighwaySpacing } from './highwaySpacing'
import { presentationVehicleColor } from './vehiclePresentationColors'

type VehicleFleet3DProps = {
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  fixedVehicles?: readonly SimulationVehicle[]
  selectedVehicleId?: string | null
  accidentVehicleId?: string | null
  relevantIds?: readonly string[]
  notifiedIds?: readonly string[]
  stage?: PresentationStage
  elapsedMs?: number
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
  strategyRole?: 'baseline' | 'ai'
}

const VEHICLE_HEIGHT = 1.45 * SCENE_SCALE
const BODY_HEIGHT = VEHICLE_HEIGHT * 0.48
const CABIN_HEIGHT = VEHICLE_HEIGHT * 0.42
const BODY_Y = 0.07 + BODY_HEIGHT / 2
const CABIN_LOCAL = new Matrix4().makeTranslation(
  HIGHWAY_VEHICLE_LENGTH * 0.08,
  BODY_HEIGHT * 0.82,
  0,
)
const CHASSIS_LOCAL = new Matrix4().makeTranslation(0, -BODY_HEIGHT * 0.31, 0)
const ROOF_LOCAL = new Matrix4().makeTranslation(
  HIGHWAY_VEHICLE_LENGTH * 0.08,
  BODY_HEIGHT * 0.82 + CABIN_HEIGHT * 0.56,
  0,
)
const MAX_INSTANCES = 100
const WHEEL_COUNT = MAX_INSTANCES * 4
const LIGHT_COUNT = MAX_INSTANCES * 2

type VehicleProfile = 'sedan' | 'suv' | 'van'

function vehicleProfile(id: string): VehicleProfile {
  const value = [...id].reduce((total, character) => total + character.charCodeAt(0), 0) % 7
  if (value === 0) return 'van'
  if (value <= 2) return 'suv'
  return 'sedan'
}

function profileScale(profile: VehicleProfile): [number, number, number] {
  if (profile === 'van') return [1.04, 1.24, 1.02]
  if (profile === 'suv') return [0.98, 1.12, 1.04]
  return [1, 0.9, 1]
}

function laneCenter(vehicle: SimulationVehicle): number {
  return HIGHWAY_LANE_CENTERS_METERS[nearestHighwayLaneIndex(vehicle.y)]
}

export function VehicleFleet3D({
  vehicles,
  animationChannel = 'single',
  fixedVehicles,
  selectedVehicleId,
  accidentVehicleId,
  relevantIds = [],
  notifiedIds = [],
  stage = 'normal',
  elapsedMs = 0,
  interactive = false,
  onVehicleSelect,
  strategyRole = 'ai',
}: VehicleFleet3DProps) {
  const { animation } = useAnimationRuntime()
  const body = useRef<InstancedMesh>(null)
  const cabin = useRef<InstancedMesh>(null)
  const chassis = useRef<InstancedMesh>(null)
  const roof = useRef<InstancedMesh>(null)
  const wheels = useRef<InstancedMesh>(null)
  const headlights = useRef<InstancedMesh>(null)
  const taillights = useRef<InstancedMesh>(null)
  const statusHalos = useRef<InstancedMesh>(null)
  const renderedIds = useRef<string[]>([])
  const transform = useMemo(() => new Object3D(), [])
  const detailTransform = useMemo(() => new Object3D(), [])
  const haloTransform = useMemo(() => new Object3D(), [])
  const detailMatrix = useMemo(() => new Matrix4(), [])
  const cabinMatrix = useMemo(() => new Matrix4(), [])
  const chassisMatrix = useMemo(() => new Matrix4(), [])
  const roofMatrix = useMemo(() => new Matrix4(), [])
  const relevant = useMemo(() => new Set(relevantIds), [relevantIds])
  const notified = useMemo(() => new Set(notifiedIds), [notifiedIds])
  const bodyGeometry = useMemo(() => new RoundedBoxGeometry(
    HIGHWAY_VEHICLE_LENGTH, BODY_HEIGHT, HIGHWAY_VEHICLE_WIDTH, 3, 0.075,
  ), [])
  const cabinGeometry = useMemo(() => new RoundedBoxGeometry(
    HIGHWAY_VEHICLE_LENGTH * 0.46, CABIN_HEIGHT, HIGHWAY_VEHICLE_WIDTH * 0.82, 3, 0.06,
  ), [])

  useFrame(() => {
    const meshes = [body.current, cabin.current, chassis.current, roof.current, wheels.current,
      headlights.current, taillights.current, statusHalos.current]
    if (meshes.some((mesh) => !mesh)) return
    const bodyMesh = body.current as InstancedMesh
    const cabinMesh = cabin.current as InstancedMesh
    const chassisMesh = chassis.current as InstancedMesh
    const roofMesh = roof.current as InstancedMesh
    const wheelMesh = wheels.current as InstancedMesh
    const headlightMesh = headlights.current as InstancedMesh
    const taillightMesh = taillights.current as InstancedMesh
    const haloMesh = statusHalos.current as InstancedMesh
    const snapshot = fixedVehicles ? null : animation.getSnapshot(animationChannel)
    const rendered = fixedVehicles
      ? fixedVehicles.slice(0, MAX_INSTANCES)
      : enforceHighwaySpacing((snapshot?.vehicles ?? vehicles).slice(0, MAX_INSTANCES))
    renderedIds.current = rendered.map((vehicle) => vehicle.id)
    bodyMesh.count = rendered.length
    cabinMesh.count = rendered.length
    chassisMesh.count = rendered.length
    roofMesh.count = rendered.length
    wheelMesh.count = rendered.length * 4
    headlightMesh.count = rendered.length * 2
    taillightMesh.count = rendered.length * 2
    haloMesh.count = rendered.length

    rendered.forEach((vehicle, index) => {
      const [x, , z] = toScenePosition(vehicle.x, laneCenter(vehicle), 'highway')
      transform.position.set(x, BODY_Y, z)
      transform.rotation.set(
        -((((vehicle as AnimatedVehicle).pitch ?? 0) * Math.PI) / 180),
        toSceneHeading(vehicle.heading, 'highway'),
        0,
      )
      const profile = vehicleProfile(vehicle.id)
      const [profileX, profileY, profileZ] = profileScale(profile)
      transform.scale.set(profileX, profileY, profileZ)
      transform.updateMatrix()
      const color = new Color(presentationVehicleColor(
        vehicle, selectedVehicleId, accidentVehicleId, relevant, notified,
      ))
      bodyMesh.setMatrixAt(index, transform.matrix)
      bodyMesh.setColorAt(index, color)
      chassisMatrix.copy(transform.matrix).multiply(CHASSIS_LOCAL)
      chassisMesh.setMatrixAt(index, chassisMatrix)
      cabinMatrix.copy(transform.matrix).multiply(CABIN_LOCAL)
      cabinMesh.setMatrixAt(index, cabinMatrix)
      roofMatrix.copy(transform.matrix).multiply(ROOF_LOCAL)
      roofMesh.setMatrixAt(index, roofMatrix)

      const wheelX = HIGHWAY_VEHICLE_LENGTH * 0.28
      const wheelZ = HIGHWAY_VEHICLE_WIDTH * 0.56
      const wheelY = -BODY_HEIGHT * 0.42
      ;[[-wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, wheelZ], [wheelX, -wheelZ]].forEach(
        ([localX, localZ], wheelIndex) => {
          detailTransform.position.set(localX, wheelY, localZ)
          detailTransform.rotation.set(Math.PI / 2, 0, 0)
          detailTransform.scale.set(1, 1, 1)
          detailTransform.updateMatrix()
          detailMatrix.multiplyMatrices(transform.matrix, detailTransform.matrix)
          wheelMesh.setMatrixAt(index * 4 + wheelIndex, detailMatrix)
        },
      )

      ;[-0.28, 0.28].forEach((side, lightIndex) => {
        detailTransform.position.set(HIGHWAY_VEHICLE_LENGTH * 0.505, 0, HIGHWAY_VEHICLE_WIDTH * side)
        detailTransform.rotation.set(0, 0, 0)
        detailTransform.scale.set(1, 1, 1)
        detailTransform.updateMatrix()
        detailMatrix.multiplyMatrices(transform.matrix, detailTransform.matrix)
        headlightMesh.setMatrixAt(index * 2 + lightIndex, detailMatrix)
        detailTransform.position.x = -HIGHWAY_VEHICLE_LENGTH * 0.505
        const braking = vehicle.id === accidentVehicleId && stage !== 'normal' && elapsedMs >= 5_150
        detailTransform.scale.set(1, braking ? 1.7 : 1, braking ? 1.28 : 1)
        detailTransform.updateMatrix()
        detailMatrix.multiplyMatrices(transform.matrix, detailTransform.matrix)
        taillightMesh.setMatrixAt(index * 2 + lightIndex, detailMatrix)
        taillightMesh.setColorAt(index * 2 + lightIndex, new Color(braking ? '#ff253f' : '#8c1f2a'))
      })

      const important = vehicle.id === accidentVehicleId
        || vehicle.id === selectedVehicleId || notified.has(vehicle.id) || relevant.has(vehicle.id)
      haloTransform.position.set(x, 0.018, z)
      haloTransform.rotation.set(-Math.PI / 2, 0, 0)
      const haloScale = vehicle.id === accidentVehicleId ? 0.34
        : strategyRole === 'baseline' && notified.has(vehicle.id) ? 0.13 : 0.25
      haloTransform.scale.setScalar(important ? haloScale : 0.001)
      haloTransform.updateMatrix()
      haloMesh.setMatrixAt(index, haloTransform.matrix)
      haloMesh.setColorAt(index, color)

    })

    for (const mesh of meshes as InstancedMesh[]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  const selectInstance = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive || event.instanceId === undefined) return
    event.stopPropagation()
    const id = renderedIds.current[event.instanceId]
    if (id) onVehicleSelect?.(id)
  }

  return (
    <group>
      <instancedMesh ref={body} args={[bodyGeometry, undefined, MAX_INSTANCES]} castShadow receiveShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onPointerDown={selectInstance}
        onPointerEnter={() => { if (interactive) document.body.style.cursor = 'pointer' }}
        onPointerLeave={() => { document.body.style.cursor = '' }}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <meshPhysicalMaterial color="#ffffff" roughness={0.26} metalness={0.58}
          clearcoat={0.72} clearcoatRoughness={0.2} />
      </instancedMesh>
      <instancedMesh ref={chassis} args={[undefined, undefined, MAX_INSTANCES]} castShadow receiveShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <boxGeometry args={[HIGHWAY_VEHICLE_LENGTH * 0.94, BODY_HEIGHT * 0.32, HIGHWAY_VEHICLE_WIDTH * 1.03]} />
        <meshStandardMaterial color="#171c21" roughness={0.7} metalness={0.42} />
      </instancedMesh>
      <instancedMesh ref={cabin} args={[cabinGeometry, undefined, MAX_INSTANCES]} castShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <meshPhysicalMaterial color="#68849b" roughness={0.1} metalness={0.22}
          transmission={0.2} thickness={0.3} clearcoat={0.82} clearcoatRoughness={0.12} />
      </instancedMesh>
      <instancedMesh ref={roof} args={[undefined, undefined, MAX_INSTANCES]} castShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <boxGeometry args={[HIGHWAY_VEHICLE_LENGTH * 0.31, CABIN_HEIGHT * 0.13, HIGHWAY_VEHICLE_WIDTH * 0.7]} />
        <meshStandardMaterial color="#d8e0e5" roughness={0.34} metalness={0.48} />
      </instancedMesh>
      <instancedMesh ref={wheels} args={[undefined, undefined, WHEEL_COUNT]} castShadow
        count={Math.min(vehicles.length * 4, WHEEL_COUNT)} frustumCulled={false}>
        <cylinderGeometry args={[0.34 * SCENE_SCALE, 0.34 * SCENE_SCALE, 0.28 * SCENE_SCALE, 12]} />
        <meshStandardMaterial color="#111317" roughness={0.92} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={headlights} args={[undefined, undefined, LIGHT_COUNT]}
        count={Math.min(vehicles.length * 2, LIGHT_COUNT)} frustumCulled={false}>
        <boxGeometry args={[0.06 * SCENE_SCALE, 0.28 * SCENE_SCALE, 0.34 * SCENE_SCALE]} />
        <meshBasicMaterial color="#fff7cc" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={taillights} args={[undefined, undefined, LIGHT_COUNT]}
        count={Math.min(vehicles.length * 2, LIGHT_COUNT)} frustumCulled={false}>
        <boxGeometry args={[0.06 * SCENE_SCALE, 0.3 * SCENE_SCALE, 0.34 * SCENE_SCALE]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={statusHalos} args={[undefined, undefined, MAX_INSTANCES]}
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <ringGeometry args={[0.72, 1, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.62} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
