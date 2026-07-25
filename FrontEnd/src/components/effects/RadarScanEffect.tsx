import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationEvent, SimulationVehicle } from '../../types/simulation'
import { toMapPosition } from '../MapView/coordinates'

type RadarProps = {
  events: SimulationEvent[]
  vehicles: SimulationVehicle[]
  candidateIds?: string[]
  animationChannel?: AnimationChannel
  active?: boolean
}

export function RadarScanEffect2D({ events, vehicles, candidateIds = [], animationChannel = 'single', active = true }: RadarProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const map = useMap()
  const startedAt = useRef<number | null>(null)
  const recognized = useRef(new Set<string>())
  useEffect(() => {
    if (active && events.length && startedAt.current === null) {
      startedAt.current = animationEngine.getSnapshot(animationChannel)?.animationTimeMs ?? 0
    }
    if (!active) {
      startedAt.current = null
      recognized.current.clear()
    }
  }, [active, animationChannel, animationEngine, events.length])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'simulation-effect-canvas radar-canvas'
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
      const event = events[0]
      const start = startedAt.current
      if (!active || !event || start === null) return
      const center = map.latLngToContainerPoint(toMapPosition(event.x, event.y))
      const edge = map.latLngToContainerPoint(toMapPosition(event.x + 300, event.y))
      const radius = Math.max(25, center.distanceTo(edge))
      const age = frame.animationTimeMs - start
      const angle = (age / 1500) * Math.PI * 2
      const scanDuration = candidateIds.length > 5 ? 3000 : 1500
      if (age <= scanDuration) {
        context.fillStyle = 'rgb(59 130 246 / 20%)'
        context.strokeStyle = 'rgb(125 211 252 / 90%)'
        context.beginPath()
        context.moveTo(center.x, center.y)
        context.arc(center.x, center.y, radius, angle - Math.PI / 3, angle)
        context.closePath()
        context.fill()
        context.stroke()
      }
      const candidates = frame.vehicles.filter((vehicle) => candidateIds.includes(vehicle.id))
      for (const vehicle of candidates) {
        const bearing = Math.atan2(vehicle.y - event.y, vehicle.x - event.x)
        const difference = Math.abs(Math.atan2(Math.sin(angle - bearing), Math.cos(angle - bearing)))
        if (difference < 0.18 || age > scanDuration) recognized.current.add(vehicle.id)
        if (!recognized.current.has(vehicle.id)) continue
        const point = map.latLngToContainerPoint(toMapPosition(vehicle.x, vehicle.y))
        context.strokeStyle = '#22c55e'
        context.lineWidth = 2
        context.beginPath()
        context.arc(point.x, point.y, 12, 0, Math.PI * 2)
        context.stroke()
      }
    })
    return () => {
      unsubscribe()
      map.off('resize', resize)
      canvas.remove()
    }
  }, [active, animationChannel, animationEngine, candidateIds, events, map, vehicles])
  return null
}
