import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  LineSegments,
  Object3D,
  Points,
  Quaternion,
  Vector3,
} from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { ParticleSystem, type ParticleTone } from '../../engine/ParticleSystem'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import {
  communicationVisualStyle,
  linkLifecycleAt,
  orderTransmissionsByPriority,
} from './communicationLinks'
import { enforceHighwaySpacing } from './highwaySpacing'
import type { SceneLayout } from './Road3D'
import { SCENE_SCALE, toScenePosition } from './sceneCoordinates'

type Message3DProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
  fixedVehicles?: readonly SimulationVehicle[]
  animationChannel?: AnimationChannel
  tone?: ParticleTone
  layout?: SceneLayout
  revealProgress?: number
  priorityByVehicle?: Readonly<Record<string, number>>
  bandwidthFraction?: number
}

const MAX_PARTICLES = 1500
const MAX_LINKS = 100
const LINK_SEGMENTS = 24
const LINK_VERTEX_COUNT = MAX_LINKS * LINK_SEGMENTS * 2
const MAX_DATA_PACKETS = MAX_LINKS * 3

function quadratic(from: number, control: number, to: number, t: number): number {
  const inverse = 1 - t
  return inverse * inverse * from + 2 * inverse * t * control + t * t * to
}

function curvePoint(
  from: Vector3,
  control: Vector3,
  to: Vector3,
  t: number,
  target: Vector3,
): Vector3 {
  return target.set(
    quadratic(from.x, control.x, to.x, t),
    quadratic(from.y, control.y, to.y, t),
    quadratic(from.z, control.z, to.z, t),
  )
}

export function Message3D({ messages, fixedVehicles, animationChannel = 'single', tone = 'ai',
  layout = 'custom', revealProgress = 1, priorityByVehicle = {},
  bandwidthFraction = tone === 'ai' ? 0.2 : 1 }: Message3DProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const points = useRef<Points>(null)
  const linkLines = useRef<LineSegments>(null)
  const arrowheads = useRef<InstancedMesh>(null)
  const deliveryRings = useRef<InstancedMesh>(null)
  const dataPackets = useRef<InstancedMesh>(null)
  const timeoutMarkers = useRef<InstancedMesh>(null)
  const system = useRef(new ParticleSystem(MAX_PARTICLES))
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const links = useMemo(
    () => orderTransmissionsByPriority(messages, tone === 'ai' ? priorityByVehicle : {}),
    [messages, priorityByVehicle, tone],
  )
  const messageSignature = useMemo(
    () => `${tone}:${links.map((message) => (
      `${message.from}>${message.to}:${message.status}:${message.delay_ms}`
    )).join('|')}`,
    [links, tone],
  )
  const particleGeometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
    value.setAttribute('color', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
    value.setDrawRange(0, 0)
    return value
  }, [])
  const linkGeometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new BufferAttribute(new Float32Array(LINK_VERTEX_COUNT * 3), 3))
    value.setAttribute('color', new BufferAttribute(new Float32Array(LINK_VERTEX_COUNT * 3), 3))
    value.setDrawRange(0, 0)
    return value
  }, [])
  const from = useMemo(() => new Vector3(), [])
  const to = useMemo(() => new Vector3(), [])
  const control = useMemo(() => new Vector3(), [])
  const previousPoint = useMemo(() => new Vector3(), [])
  const currentPoint = useMemo(() => new Vector3(), [])
  const tangent = useMemo(() => new Vector3(), [])
  const up = useMemo(() => new Vector3(0, 1, 0), [])
  const arrowQuaternion = useMemo(() => new Quaternion(), [])
  const arrowTransform = useMemo(() => new Object3D(), [])
  const ringTransform = useMemo(() => new Object3D(), [])
  const packetTransform = useMemo(() => new Object3D(), [])
  const timeoutTransform = useMemo(() => new Object3D(), [])
  const normalizedPriorities = useMemo(() => {
    const maximum = Math.max(0, ...Object.values(priorityByVehicle))
    return Object.fromEntries(Object.entries(priorityByVehicle).map(([id, value]) => [
      id, maximum > 0 ? value / maximum : 0,
    ]))
  }, [priorityByVehicle])

  useEffect(() => () => {
    system.current.clear()
    particleGeometry.dispose()
    linkGeometry.dispose()
  }, [linkGeometry, particleGeometry])

  useEffect(() => {
    system.current.clear()
  }, [messageSignature])

  useFrame(() => {
    const frame = animationEngine.getSnapshot(animationChannel)
    if (!frame && !fixedVehicles) return
    const renderVehicles = fixedVehicles
      ?? enforceHighwaySpacing(frame?.vehicles ?? [])
    const vehiclesById = new Map(renderVehicles.map((vehicle) => [vehicle.id, vehicle]))
    const linkPositions = linkGeometry.getAttribute('position') as BufferAttribute
    const linkColors = linkGeometry.getAttribute('color') as BufferAttribute
    let lineVertex = 0
    let arrowCount = 0
    let ringCount = 0
    let packetCount = 0
    let timeoutCount = 0
    const effectiveReveal = reducedMotion ? 1 : revealProgress

    links.forEach((message, linkIndex) => {
      const lifecycle = linkLifecycleAt(linkIndex, links.length, effectiveReveal)
      if (lifecycle.phase === 'pending') return
      const sender = vehiclesById.get(message.from)
      const receiver = vehiclesById.get(message.to)
      if (!sender || !receiver || lineVertex + LINK_SEGMENTS * 2 > LINK_VERTEX_COUNT) return
      const senderPosition = toScenePosition(sender.x, sender.y, layout)
      const receiverPosition = toScenePosition(receiver.x, receiver.y, layout)
      from.set(senderPosition[0], 0.62, senderPosition[2])
      to.set(receiverPosition[0], 0.62, receiverPosition[2])
      const dx = to.x - from.x
      const dz = to.z - from.z
      const distance = Math.max(0.1, Math.hypot(dx, dz))
      const side = linkIndex % 2 === 0 ? 1 : -1
      const receiverLane = Math.round(receiver.y / 3.2)
      const visualStyle = communicationVisualStyle(
        tone, message.status, message.delay_ms, bandwidthFraction, receiverLane, distance,
      )
      const lateral = side * visualStyle.lateralOffset
      control.set(
        (from.x + to.x) / 2 - (dz / distance) * lateral,
        0.92 + Math.min(tone === 'ai' ? 1.5 : 2.1, distance * 0.085),
        (from.z + to.z) / 2 + (dx / distance) * lateral,
      )
      previousPoint.copy(from)
      const visibleSegments = Math.max(1, Math.ceil(LINK_SEGMENTS * lifecycle.progress))
      const priority = normalizedPriorities[message.to] ?? (tone === 'ai' ? 0.45 : 0.18)
      const linkColor = new Color(visualStyle.color)
      linkColor.lerp(new Color('#efffff'), priority * 0.34)
      for (let segment = 1; segment <= visibleSegments; segment += 1) {
        curvePoint(from, control, to, segment / LINK_SEGMENTS, currentPoint)
        linkPositions.setXYZ(lineVertex, previousPoint.x, previousPoint.y, previousPoint.z)
        linkPositions.setXYZ(lineVertex + 1, currentPoint.x, currentPoint.y, currentPoint.z)
        linkColors.setXYZ(lineVertex, linkColor.r, linkColor.g, linkColor.b)
        linkColors.setXYZ(lineVertex + 1, linkColor.r, linkColor.g, linkColor.b)
        lineVertex += 2
        previousPoint.copy(currentPoint)
      }
      const packetInstances = visualStyle.packetCount
      const animationTimeMs = frame?.animationTimeMs ?? 0
      for (let packetIndex = 0; packetIndex < packetInstances
        && dataPackets.current && packetCount < MAX_DATA_PACKETS; packetIndex += 1) {
        const cycleMs = visualStyle.packetCycleMs
        const phase = ((animationTimeMs / cycleMs) + packetIndex / packetInstances
          + linkIndex * 0.071) % 1
        const packetAt = Math.min(Math.max(0.035, lifecycle.progress), 0.06 + phase * 0.9)
        curvePoint(from, control, to, Math.max(0, packetAt - 0.025), previousPoint)
        curvePoint(from, control, to, packetAt, currentPoint)
        tangent.subVectors(currentPoint, previousPoint).normalize()
        arrowQuaternion.setFromUnitVectors(up, tangent)
        packetTransform.position.copy(currentPoint)
        packetTransform.quaternion.copy(arrowQuaternion)
        packetTransform.scale.set(0.7 + priority * 0.42, 1.25 + priority * 0.55, 0.7 + priority * 0.42)
        packetTransform.updateMatrix()
        dataPackets.current.setMatrixAt(packetCount, packetTransform.matrix)
        dataPackets.current.setColorAt(packetCount, linkColor)
        packetCount += 1
      }
      if (arrowheads.current && arrowCount < MAX_LINKS) {
        const arrowAt = Math.max(0.08, Math.min(0.965, lifecycle.progress))
        curvePoint(from, control, to, Math.max(0, arrowAt - 0.045), previousPoint)
        curvePoint(from, control, to, arrowAt, currentPoint)
        tangent.subVectors(currentPoint, previousPoint).normalize()
        arrowQuaternion.setFromUnitVectors(up, tangent)
        arrowTransform.position.copy(currentPoint)
        arrowTransform.quaternion.copy(arrowQuaternion)
        arrowTransform.scale.setScalar(tone === 'ai' ? 0.66 : 0.38)
        arrowTransform.updateMatrix()
        arrowheads.current.setMatrixAt(arrowCount, arrowTransform.matrix)
        const arrowColor = message.status === 'timeout'
          ? new Color('#ef4444') : new Color(tone === 'ai' ? '#45e0b7' : '#a9b5c0')
        arrowheads.current.setColorAt(arrowCount, arrowColor)
        arrowCount += 1
      }
      if (deliveryRings.current && lifecycle.phase === 'delivered' && ringCount < MAX_LINKS) {
        const ringAge = Math.min(1, (lifecycle.progress - 0.82) / 0.18)
        ringTransform.position.set(to.x, 0.09, to.z)
        ringTransform.rotation.set(-Math.PI / 2, 0, 0)
        ringTransform.scale.setScalar(0.15 + ringAge * 0.38)
        ringTransform.updateMatrix()
        deliveryRings.current.setMatrixAt(ringCount, ringTransform.matrix)
        deliveryRings.current.setColorAt(ringCount, new Color(
          message.status === 'timeout' ? '#ef4444' : tone === 'ai' ? '#45e0b7' : '#b5c0ca',
        ))
        ringCount += 1
      }
      if (message.status === 'timeout' && timeoutMarkers.current && timeoutCount < MAX_LINKS) {
        curvePoint(from, control, to, Math.min(0.82, lifecycle.progress), currentPoint)
        timeoutTransform.position.copy(currentPoint)
        timeoutTransform.rotation.set(0, animationTimeMs * 0.0015, Math.PI / 4)
        timeoutTransform.scale.setScalar(0.12 + priority * 0.06)
        timeoutTransform.updateMatrix()
        timeoutMarkers.current.setMatrixAt(timeoutCount, timeoutTransform.matrix)
        timeoutCount += 1
      }
    })
    linkGeometry.setDrawRange(0, lineVertex)
    linkPositions.needsUpdate = true
    linkColors.needsUpdate = true
    if (linkLines.current) linkLines.current.visible = links.length > 0
    if (arrowheads.current) {
      arrowheads.current.count = arrowCount
      arrowheads.current.instanceMatrix.needsUpdate = true
      if (arrowheads.current.instanceColor) arrowheads.current.instanceColor.needsUpdate = true
    }
    if (deliveryRings.current) {
      deliveryRings.current.count = ringCount
      deliveryRings.current.instanceMatrix.needsUpdate = true
      if (deliveryRings.current.instanceColor) deliveryRings.current.instanceColor.needsUpdate = true
    }
    if (dataPackets.current) {
      dataPackets.current.count = packetCount
      dataPackets.current.instanceMatrix.needsUpdate = true
      if (dataPackets.current.instanceColor) dataPackets.current.instanceColor.needsUpdate = true
    }
    if (timeoutMarkers.current) {
      timeoutMarkers.current.count = timeoutCount
      timeoutMarkers.current.instanceMatrix.needsUpdate = true
    }

    const visibleMessages = links.filter((_, index) => (
      linkLifecycleAt(index, links.length, effectiveReveal).phase !== 'pending'
    ))
    if (!reducedMotion && visibleMessages.length > 0) {
      const animationTimeMs = frame?.animationTimeMs ?? 0
      const pulseTimestamp = (frame?.timestamp ?? 0) + Math.floor(animationTimeMs / 1800) / 1000
      system.current.ingest(visibleMessages, renderVehicles, pulseTimestamp, animationTimeMs, tone)
    }
    const particles = reducedMotion ? []
      : system.current.update(frame?.animationTimeMs ?? 0).slice(0, MAX_PARTICLES)
    const positions = particleGeometry.getAttribute('position') as BufferAttribute
    const colors = particleGeometry.getAttribute('color') as BufferAttribute
    particles.forEach((particle, index) => {
      const [x, , z] = toScenePosition(particle.x, particle.y, layout)
      positions.setXYZ(index, x, 0.72 + particle.height * SCENE_SCALE, z)
      const color = new Color(particle.color).multiplyScalar(Math.max(0.3, particle.alpha))
      colors.setXYZ(index, color.r, color.g, color.b)
    })
    particleGeometry.setDrawRange(0, particles.length)
    positions.needsUpdate = true
    colors.needsUpdate = true
  })

  return (
    <group>
      <lineSegments ref={linkLines} geometry={linkGeometry} renderOrder={3} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={tone === 'ai' ? 0.24 : 0.13}
          depthWrite={false} toneMapped={false} blending={2} />
      </lineSegments>
      <lineSegments geometry={linkGeometry} renderOrder={4} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={tone === 'ai' ? 0.82 : 0.46}
          depthWrite={false} toneMapped={false} />
      </lineSegments>
      <instancedMesh ref={arrowheads} args={[undefined, undefined, MAX_LINKS]} frustumCulled={false}
        count={Math.min(links.length, MAX_LINKS)} renderOrder={5}>
        <coneGeometry args={[0.035, 0.12, 10]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={tone === 'ai' ? 0.95 : 0.62}
          depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={deliveryRings} args={[undefined, undefined, MAX_LINKS]}
        frustumCulled={false} count={0} renderOrder={5}>
        <ringGeometry args={[0.72, 1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={tone === 'ai' ? 0.72 : 0.38}
          depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={dataPackets} args={[undefined, undefined, MAX_DATA_PACKETS]}
        frustumCulled={false} count={0} renderOrder={7}>
        <capsuleGeometry args={[0.026, 0.09, 3, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={tone === 'ai' ? 0.98 : 0.72}
          depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={timeoutMarkers} args={[undefined, undefined, MAX_LINKS]}
        frustumCulled={false} count={0} renderOrder={8}>
        <octahedronGeometry args={[0.12, 0]} />
        <meshBasicMaterial color="#ff405c" transparent opacity={0.9}
          depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <points ref={points} geometry={particleGeometry} renderOrder={6}>
        <pointsMaterial size={tone === 'ai' ? 0.2 : 0.11} vertexColors transparent
          opacity={tone === 'ai' ? 0.95 : 0.48} depthWrite={false} sizeAttenuation toneMapped={false} />
      </points>
    </group>
  )
}
