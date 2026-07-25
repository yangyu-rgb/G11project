import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Points } from 'three'

import { animationEngine, type AnimationChannel } from '../../engine/AnimationEngine'
import { ParticleSystem, type ParticleTone } from '../../engine/ParticleSystem'
import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import { SCENE_SCALE } from './sceneCoordinates'

type Message3DProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  tone?: ParticleTone
}

const MAX_PARTICLES = 1500

export function Message3D({ animationChannel = 'single', tone = 'ai' }: Message3DProps) {
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

  useFrame(() => {
    const frame = animationEngine.getSnapshot(animationChannel)
    if (!frame) return
    system.current.ingest(frame.messages, frame.vehicles, frame.timestamp, frame.animationTimeMs, tone)
    const particles = system.current.update(frame.animationTimeMs).slice(0, MAX_PARTICLES)
    const positions = geometry.getAttribute('position') as BufferAttribute
    const colors = geometry.getAttribute('color') as BufferAttribute
    particles.forEach((particle, index) => {
      positions.setXYZ(index, particle.x * SCENE_SCALE, 0.72 + particle.height * SCENE_SCALE, particle.y * SCENE_SCALE)
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
