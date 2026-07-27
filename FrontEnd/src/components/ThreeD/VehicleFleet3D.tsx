import type { ThreeEvent } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
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
  selectedVehicleId?: string | null
  accidentVehicleId?: string | null
  relevantIds?: readonly string[]
  notifiedIds?: readonly string[]
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
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
const MAX_INSTANCES = 100
const WHEEL_COUNT = MAX_INSTANCES * 4
const LIGHT_COUNT = MAX_INSTANCES * 2
function laneCenter(vehicle: SimulationVehicle): number {
  return HIGHWAY_LANE_CENTERS_METERS[nearestHighwayLaneIndex(vehicle.y)]
}

export function VehicleFleet3D({
  vehicles,
  animationChannel = 'single',
  selectedVehicleId,
  accidentVehicleId,
  relevantIds = [],
  notifiedIds = [],
  interactive = false,
  onVehicleSelect,
}: VehicleFleet3DProps) {
  const { animation } = useAnimationRuntime()
  const body = useRef<InstancedMesh>(null)
  const cabin = useRef<InstancedMesh>(null)
  const wheels = useRef<InstancedMesh>(null)
  const headlights = useRef<InstancedMesh>(null)
  const taillights = useRef<InstancedMesh>(null)
  const renderedIds = useRef<string[]>([])
  const transform = useMemo(() => new Object3D(), [])
  const detailTransform = useMemo(() => new Object3D(), [])
  const detailMatrix = useMemo(() => new Matrix4(), [])
  const cabinMatrix = useMemo(() => new Matrix4(), [])
  const relevant = useMemo(() => new Set(relevantIds), [relevantIds])
  const notified = useMemo(() => new Set(notifiedIds), [notifiedIds])

  useFrame(() => {
    const meshes = [body.current, cabin.current, wheels.current, headlights.current, taillights.current]
    if (meshes.some((mesh) => !mesh)) return
    const bodyMesh = body.current as InstancedMesh
    const cabinMesh = cabin.current as InstancedMesh
    const wheelMesh = wheels.current as InstancedMesh
    const headlightMesh = headlights.current as InstancedMesh
    const taillightMesh = taillights.current as InstancedMesh
    const snapshot = animation.getSnapshot(animationChannel)
    const rendered = enforceHighwaySpacing((snapshot?.vehicles ?? vehicles).slice(0, MAX_INSTANCES))
    renderedIds.current = rendered.map((vehicle) => vehicle.id)
    bodyMesh.count = rendered.length
    cabinMesh.count = rendered.length
    wheelMesh.count = rendered.length * 4
    headlightMesh.count = rendered.length * 2
    taillightMesh.count = rendered.length * 2

    rendered.forEach((vehicle, index) => {
      const [x, , z] = toScenePosition(vehicle.x, laneCenter(vehicle), 'highway')
      transform.position.set(x, BODY_Y, z)
      transform.rotation.set(
        -((((vehicle as AnimatedVehicle).pitch ?? 0) * Math.PI) / 180),
        toSceneHeading(vehicle.heading, 'highway'),
        0,
      )
      transform.scale.set(1, 1, 1)
      transform.updateMatrix()
      const color = new Color(presentationVehicleColor(
        vehicle, selectedVehicleId, accidentVehicleId, relevant, notified,
      ))
      bodyMesh.setMatrixAt(index, transform.matrix)
      bodyMesh.setColorAt(index, color)
      cabinMatrix.copy(transform.matrix).multiply(CABIN_LOCAL)
      cabinMesh.setMatrixAt(index, cabinMatrix)

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
        detailTransform.updateMatrix()
        detailMatrix.multiplyMatrices(transform.matrix, detailTransform.matrix)
        taillightMesh.setMatrixAt(index * 2 + lightIndex, detailMatrix)
      })

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
      <instancedMesh ref={body} args={[undefined, undefined, MAX_INSTANCES]} castShadow receiveShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onPointerDown={selectInstance}
        onPointerEnter={() => { if (interactive) document.body.style.cursor = 'pointer' }}
        onPointerLeave={() => { document.body.style.cursor = '' }}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <boxGeometry args={[HIGHWAY_VEHICLE_LENGTH, BODY_HEIGHT, HIGHWAY_VEHICLE_WIDTH]} />
        <meshStandardMaterial color="#ffffff" roughness={0.28} metalness={0.68} />
      </instancedMesh>
      <instancedMesh ref={cabin} args={[undefined, undefined, MAX_INSTANCES]} castShadow
        count={Math.min(vehicles.length, MAX_INSTANCES)} frustumCulled={false}
        onUpdate={(mesh) => mesh.instanceMatrix.setUsage(DynamicDrawUsage)}>
        <boxGeometry args={[HIGHWAY_VEHICLE_LENGTH * 0.46, CABIN_HEIGHT, HIGHWAY_VEHICLE_WIDTH * 0.82]} />
        <meshPhysicalMaterial color="#8da4b8" roughness={0.12} metalness={0.18}
          transmission={0.12} clearcoat={0.75} clearcoatRoughness={0.16} />
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
        <meshBasicMaterial color="#ff2d2d" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
