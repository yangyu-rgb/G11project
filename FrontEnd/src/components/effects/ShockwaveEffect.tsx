import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

import { animationEngine, type AnimationChannel } from '../../engine/AnimationEngine'
import { easeOutCubic } from '../../engine/Interpolator'
import type { SimulationEvent } from '../../types/simulation'
import { toMapPosition } from '../MapView/coordinates'

type EffectProps = {
  events: SimulationEvent[]
  animationChannel?: AnimationChannel
  active?: boolean
}

type TriggeredEvent = SimulationEvent & { startedAt: number }

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ShockwaveEffect2D({ events, animationChannel = 'single', active = true }: EffectProps) {
  const map = useMap()
  const triggered = useRef(new Map<string, TriggeredEvent>())

  useEffect(() => {
    if (!active) return
    const now = animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0
    for (const event of events) {
      const key = `${event.id}:${event.timestamp}`
      if (!triggered.current.has(key)) triggered.current.set(key, { ...event, startedAt: now })
    }
  }, [active, animationChannel, events])

  useEffect(() => {
    const effects = triggered.current
    const canvas = document.createElement('canvas')
    canvas.className = 'simulation-effect-canvas shockwave-canvas'
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
    map.on('resize', resize)
    const unsubscribe = animationEngine.subscribe(animationChannel, (frame) => {
      const context = canvas.getContext('2d')
      if (!context) return
      const size = map.getSize()
      const ratio = canvas.width / Math.max(1, size.x)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, size.x, size.y)
      for (const [key, event] of effects) {
        const center = map.latLngToContainerPoint(toMapPosition(event.x, event.y))
        const edge = map.latLngToContainerPoint(toMapPosition(event.x + 300, event.y))
        const maximum = Math.max(20, center.distanceTo(edge))
        const age = frame.animationTimeMs - event.startedAt
        if (age > 2800) {
          effects.delete(key)
          continue
        }
        for (let layer = 0; layer < 3; layer += 1) {
          const progress = reducedMotion() ? 1 : Math.min(1, Math.max(0, (age - layer * 300) / 1500))
          if (progress <= 0) continue
          context.globalAlpha = reducedMotion() ? 0.3 : 0.8 * (1 - progress)
          context.strokeStyle = '#fb6340'
          context.lineWidth = 3 - layer * 0.45
          context.beginPath()
          context.arc(center.x, center.y, maximum * easeOutCubic(progress), 0, Math.PI * 2)
          context.stroke()
        }
      }
      context.globalAlpha = 1
    })
    return () => {
      unsubscribe()
      map.off('resize', resize)
      canvas.remove()
    }
  }, [animationChannel, map])
  return null
}
