import L from 'leaflet'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Tooltip } from 'react-leaflet'

import type { SimulationVehicle, VehicleStatus } from '../../types/simulation'
import { smoothstep } from '../../utils/interpolation'
import { toMapPosition } from './coordinates'
import {
  interpolateVehicles,
  VEHICLE_INTERPOLATION_DURATION_MS,
} from './vehicleInterpolation'
import './VehicleLayer.css'

type VehicleLayerProps = {
  vehicles: SimulationVehicle[]
  onVehicleSelect?: (vehicle: SimulationVehicle) => void
}

const labels: Record<VehicleStatus, string> = {
  normal: '正常',
  sending: '发送消息',
  receiving: '接收消息',
}

type VehicleMarkerProps = {
  vehicle: SimulationVehicle
  onSelect?: (vehicle: SimulationVehicle) => void
}

const VehicleMarker = memo(function VehicleMarker({ vehicle, onSelect }: VehicleMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null)
  const icon = useMemo(
    () => L.divIcon({
      className: 'vehicle-marker-icon',
      html: `<span class="vehicle-marker__body vehicle-marker__body--${vehicle.status}"><span class="vehicle-marker__arrow"></span></span>`,
      iconAnchor: [11, 11],
      iconSize: [22, 22],
      tooltipAnchor: [0, -12],
    }),
    [vehicle.status],
  )
  const speedKmh = Math.hypot(vehicle.vx, vehicle.vy) * 3.6

  useEffect(() => {
    const arrow = markerRef.current
      ?.getElement()
      ?.querySelector<HTMLElement>('.vehicle-marker__arrow')
    arrow?.style.setProperty('--vehicle-heading', `${vehicle.heading}deg`)
  }, [vehicle.heading, vehicle.status])

  return (
    <Marker
      ref={markerRef}
      alt={`车辆 ${vehicle.id}`}
      icon={icon}
      keyboard
      position={toMapPosition(vehicle.x, vehicle.y)}
      title={`${vehicle.id}，${labels[vehicle.status]}`}
      eventHandlers={onSelect ? { click: () => onSelect(vehicle) } : undefined}
    >
      <Tooltip direction="top">
        <strong>{vehicle.id}</strong><br />
        {speedKmh.toFixed(1)} km/h · {labels[vehicle.status]}<br />
        航向：{vehicle.heading.toFixed(1)}°
      </Tooltip>
    </Marker>
  )
}, ({ vehicle: previous, onSelect: previousSelect }, { vehicle: next, onSelect: nextSelect }) => (
  previous.id === next.id
  && previous.x === next.x
  && previous.y === next.y
  && previous.vx === next.vx
  && previous.vy === next.vy
  && previous.heading === next.heading
  && previous.status === next.status
  && previousSelect === nextSelect
))

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function VehicleLayer({ vehicles, onVehicleSelect }: VehicleLayerProps) {
  const [displayedVehicles, setDisplayedVehicles] = useState(vehicles)
  const displayedRef = useRef(vehicles)
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (prefersReducedMotion() || displayedRef.current.length === 0) {
      displayedRef.current = vehicles
      setDisplayedVehicles(vehicles)
      return
    }

    const starts = displayedRef.current
    const startedAt = performance.now()

    const renderFrame = (now: number) => {
      const progress = (now - startedAt) / VEHICLE_INTERPOLATION_DURATION_MS
      const nextVehicles = progress >= 1
        ? vehicles
        : interpolateVehicles(starts, vehicles, smoothstep(0, 1, progress))

      displayedRef.current = nextVehicles
      setDisplayedVehicles(nextVehicles)

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(renderFrame)
      } else {
        animationFrameRef.current = null
      }
    }

    animationFrameRef.current = requestAnimationFrame(renderFrame)
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [vehicles])

  return displayedVehicles.map((vehicle) => (
    <VehicleMarker key={vehicle.id} vehicle={vehicle} onSelect={onVehicleSelect} />
  ))
}
