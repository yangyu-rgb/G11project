import L from 'leaflet'
import { Fragment } from 'react'
import { Circle, Marker, Tooltip } from 'react-leaflet'

import type { SimulationEvent } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type EventLayerProps = {
  events: SimulationEvent[]
  onEventSelect?: (event: SimulationEvent) => void
}

const warningIcon = L.divIcon({
  className: 'emergency-event-icon',
  html: '<span aria-hidden="true">!</span>',
  iconAnchor: [16, 16],
  iconSize: [32, 32],
})

export function EventLayer({ events, onEventSelect }: EventLayerProps) {
  const labels: Record<string, string> = {
    emergency_brake: '急刹事件',
    emergency_braking: '急刹事件',
    obstacle: '障碍物',
    collision_warning: '碰撞预警',
  }
  return events.map((event) => (
    <Fragment key={event.id}>
    <Circle center={toMapPosition(event.x, event.y)} radius={300}
      pathOptions={{ color: '#fb6340', fillColor: '#ef4444', fillOpacity: 0.08, opacity: 0.7, dashArray: '8 8', weight: 2 }}
      className="event-risk-zone" />
    <Marker
      key={event.id}
      position={toMapPosition(event.x, event.y)}
      icon={warningIcon}
      eventHandlers={onEventSelect ? { click: () => onEventSelect(event) } : undefined}
    >
      <Tooltip direction="top" offset={[0, -14]}>
        <strong>{labels[event.type] ?? event.type}</strong><br />
        时间：{event.timestamp.toFixed(1)}s · 严重度：{event.severity.toFixed(2)}
      </Tooltip>
    </Marker>
    </Fragment>
  ))
}
