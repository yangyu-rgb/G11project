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
import { linkLifecycleAt, orderTransmissionsByPriority } from './communicationLinks'
import type { SceneLayout } from './Road3D'
import { SCENE_SCALE, toScenePosition } from './sceneCoordinates'

type Message3DProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  tone?: ParticleTone
  layout?: SceneLayout
  revealProgress?: number
  priorityByVehicle?: Readonly<Record<string, number>>
}

const MAX_PARTICLES = 1500
const MAX_LINKS = 100
const LINK_SEGMENTS = 24
const LINK_VERTEX_COUNT = MAX_LINKS * LINK_SEGMENTS * 2

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

export function Message3D({ messages, animationChannel = 'single', tone = 'ai', layout = 'custom',
  revealProgress = 1, priorityByVehicle = {} }: Message3DProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const points = useRef<Points>(null)
  const linkLines = useRef<LineSegments>(null)
  const arrowheads = useRef<InstancedMesh>(null)
  const deliveryRings = useRef<InstancedMesh>(null)
  const system = useRef(new ParticleSystem(MAX_PARTICLES))
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const links = useMemo(
    () => orderTransmissionsByPriority(messages, tone === 'ai' ? priorityByVehicle : {}),
    [messages, priorityByVehicle, tone],
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

  useEffect(() => () => {
    system.current.clear()
    particleGeometry.dispose()
    linkGeometry.dispose()
  }, [linkGeometry, particleGeometry])

  useEffect(() => {
    if (messages.length === 0) system.current.clear()
  }, [messages.length])

  useFrame(() => {
    const frame = animationEngine.getSnapshot(animationChannel)
    if (!frame) return
    const vehiclesById = new Map(frame.vehicles.map((vehicle) => [vehicle.id, vehicle]))
    const linkPositions = linkGeometry.getAttribute('position') as BufferAttribute
    let lineVertex = 0
    let arrowCount = 0
    let ringCount = 0
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
      const lateral = side * (0.18 + (linkIndex % 4) * 0.045)
      control.set(
        (from.x + to.x) / 2 - (dz / distance) * lateral,
        0.92 + Math.min(tone === 'ai' ? 1.5 : 2.1, distance * 0.085),
        (from.z + to.z) / 2 + (dx / distance) * lateral,
      )
      previousPoint.copy(from)
      const visibleSegments = Math.max(1, Math.ceil(LINK_SEGMENTS * lifecycle.progress))
      for (let segment = 1; segment <= visibleSegments; segment += 1) {
        curvePoint(from, control, to, segment / LINK_SEGMENTS, currentPoint)
        linkPositions.setXYZ(lineVertex, previousPoint.x, previousPoint.y, previousPoint.z)
        linkPositions.setXYZ(lineVertex + 1, currentPoint.x, currentPoint.y, currentPoint.z)
        lineVertex += 2
        previousPoint.copy(currentPoint)
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
    })
    linkGeometry.setDrawRange(0, lineVertex)
    linkPositions.needsUpdate = true
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

    const visibleMessages = links.filter((_, index) => (
      linkLifecycleAt(index, links.length, effectiveReveal).phase !== 'pending'
    ))
    if (!reducedMotion && visibleMessages.length > 0) {
      const pulseTimestamp = frame.timestamp + Math.floor(frame.animationTimeMs / 1800) / 1000
      system.current.ingest(visibleMessages, frame.vehicles, pulseTimestamp, frame.animationTimeMs, tone)
    }
    const particles = reducedMotion ? [] : system.current.update(frame.animationTimeMs).slice(0, MAX_PARTICLES)
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

  const lineColor = tone === 'ai' ? '#33c8ed' : '#a5b0ba'
  return (
    <group>
      <lineSegments ref={linkLines} geometry={linkGeometry} renderOrder={3} frustumCulled={false}>
        <lineBasicMaterial color={lineColor} transparent opacity={tone === 'ai' ? 0.34 : 0.16}
          depthWrite={false} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={linkGeometry} renderOrder={4} frustumCulled={false}>
        <lineBasicMaterial color={lineColor} transparent opacity={tone === 'ai' ? 0.74 : 0.32}
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
      <points ref={points} geometry={particleGeometry} renderOrder={6}>
        <pointsMaterial size={tone === 'ai' ? 0.2 : 0.11} vertexColors transparent
          opacity={tone === 'ai' ? 0.95 : 0.48} depthWrite={false} sizeAttenuation toneMapped={false} />
      </points>
    </group>
  )
}
