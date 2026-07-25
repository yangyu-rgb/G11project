import L from 'leaflet'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Marker, Tooltip } from 'react-leaflet'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import type { SimulationVehicle, VehicleStatus } from '../../types/simulation'
import { toMapPosition } from './coordinates'
import './VehicleLayer.css'

type VehicleLayerProps = {
  vehicles: SimulationVehicle[]
  animationChannel?: AnimationChannel
  onVehicleSelect?: (vehicle: SimulationVehicle) => void
}

const labels: Record<VehicleStatus, string> = {
  normal: '正常',
  sending: '发送消息',
  receiving: '接收消息',
}

type VehicleMarkerProps = {
  vehicle: SimulationVehicle
  animationChannel: AnimationChannel
  onSelect?: (vehicle: SimulationVehicle) => void
}

const VehicleMarker = memo(function VehicleMarker({ vehicle, animationChannel, onSelect }: VehicleMarkerProps) {
  const { animation: animationEngine } = useAnimationRuntime()
  const markerRef = useRef<L.Marker | null>(null)
  const icon = useMemo(
    () => L.divIcon({
      className: 'vehicle-marker-icon',
      html: `<span class="vehicle-marker__effects vehicle-marker__effects--${vehicle.status}"></span><span class="vehicle-marker__body vehicle-marker__body--${vehicle.status}"><span class="vehicle-marker__glass"></span><span class="vehicle-marker__arrow"></span><span class="vehicle-marker__brake-light"></span></span>`,
      iconAnchor: [16, 12],
      iconSize: [32, 24],
      tooltipAnchor: [0, -12],
    }),
    [vehicle.status],
  )
  const speedKmh = Math.hypot(vehicle.vx, vehicle.vy) * 3.6

  useEffect(() => animationEngine.subscribe(animationChannel, (frame) => {
    const animated = frame.vehicles.find((item) => item.id === vehicle.id)
    const marker = markerRef.current
    if (!animated || !marker) return
    marker.setLatLng(toMapPosition(animated.x, animated.y))
    const element = marker.getElement()
    element?.style.setProperty('--vehicle-heading', `${animated.heading}deg`)
    element?.style.setProperty('--vehicle-pitch', `${-animated.pitch}deg`)
    if (element) element.dataset.motion = animated.motion
  }), [animationChannel, animationEngine, vehicle.id])

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
}, ({ vehicle: previous, animationChannel: previousChannel, onSelect: previousSelect }, { vehicle: next, animationChannel: nextChannel, onSelect: nextSelect }) => (
  previous.id === next.id
  && previous.x === next.x
  && previous.y === next.y
  && previous.vx === next.vx
  && previous.vy === next.vy
  && previous.heading === next.heading
  && previous.status === next.status
  && previousChannel === nextChannel
  && previousSelect === nextSelect
))

export function VehicleLayer({ vehicles, animationChannel = 'single', onVehicleSelect }: VehicleLayerProps) {
  return vehicles.map((vehicle) => (
    <VehicleMarker key={vehicle.id} vehicle={vehicle} animationChannel={animationChannel} onSelect={onVehicleSelect} />
  ))
}
