import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

import { animationEngine, type AnimationChannel } from '../../engine/AnimationEngine'
import { ParticleSystem, type ParticleTone } from '../../engine/ParticleSystem'
import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type MessageLayerProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  tone?: ParticleTone
}

export function MessageLayer({ animationChannel = 'single', tone = 'ai' }: MessageLayerProps) {
  const map = useMap()
  const system = useRef(new ParticleSystem())

  useEffect(() => {
    const particleSystem = system.current
    const canvas = document.createElement('canvas')
    canvas.className = `message-particle-canvas message-particle-canvas--${tone}`
    map.getContainer().append(canvas)
    const resize = () => {
      const size = map.getSize()
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = size.x * ratio
      canvas.height = size.y * ratio
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    resize()
    map.on('resize zoom move', resize)
    const unsubscribe = animationEngine.subscribe(animationChannel, (frame) => {
      const particles = particleSystem
      particles.ingest(frame.messages, frame.vehicles, frame.timestamp, frame.animationTimeMs, tone)
      const context = canvas.getContext('2d')
      if (!context) return
      const ratio = canvas.width / Math.max(1, map.getSize().x)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, map.getSize().x, map.getSize().y)
      for (const particle of particles.update(frame.animationTimeMs)) {
        const point = map.latLngToContainerPoint(toMapPosition(particle.x, particle.y))
        context.globalAlpha = particle.alpha
        context.fillStyle = particle.color
        context.shadowColor = particle.color
        context.shadowBlur = tone === 'ai' ? 8 : 2
        context.beginPath()
        context.arc(point.x, point.y, particle.size, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      context.shadowBlur = 0
    })
    return () => {
      unsubscribe()
      particleSystem.clear()
      map.off('resize zoom move', resize)
      canvas.remove()
    }
  }, [animationChannel, map, tone])

  return null
}
