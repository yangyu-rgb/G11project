import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Points } from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { ParticleSystem, type ParticleTone } from '../../engine/ParticleSystem'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import type { SceneLayout } from './Road3D'
import { SCENE_SCALE, toScenePosition } from './sceneCoordinates'

type Message3DProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  tone?: ParticleTone
  layout?: SceneLayout
}

const MAX_PARTICLES = 1500

export function Message3D({ messages, animationChannel = 'single', tone = 'ai', layout = 'custom' }: Message3DProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const points = useRef<Points>(null)
  const system = useRef(new ParticleSystem(MAX_PARTICLES))
  const geometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
    value.setAttribute('color', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
    value.setDrawRange(0, 0)
    return value
  }, [])

  useEffect(() => () => {
    system.current.clear()
    geometry.dispose()
  }, [geometry])

  useEffect(() => {
    if (messages.length === 0) system.current.clear()
  }, [messages.length])

  useFrame(() => {
    const frame = animationEngine.getSnapshot(animationChannel)
    if (!frame) return
    if (messages.length > 0) {
      const pulseTimestamp = frame.timestamp + Math.floor(frame.animationTimeMs / 1800) / 1000
      system.current.ingest(messages, frame.vehicles, pulseTimestamp, frame.animationTimeMs, tone)
    }
    const particles = system.current.update(frame.animationTimeMs).slice(0, MAX_PARTICLES)
    const positions = geometry.getAttribute('position') as BufferAttribute
    const colors = geometry.getAttribute('color') as BufferAttribute
    particles.forEach((particle, index) => {
      const [x, , z] = toScenePosition(particle.x, particle.y, layout)
      positions.setXYZ(index, x, 0.72 + particle.height * SCENE_SCALE, z)
      const color = new Color(particle.color).multiplyScalar(Math.max(0.3, particle.alpha))
      colors.setXYZ(index, color.r, color.g, color.b)
    })
    geometry.setDrawRange(0, particles.length)
    positions.needsUpdate = true
    colors.needsUpdate = true
  })

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial size={tone === 'ai' ? 0.22 : 0.13} vertexColors transparent opacity={tone === 'ai' ? 0.95 : 0.45}
        depthWrite={false} sizeAttenuation />
    </points>
  )
}
