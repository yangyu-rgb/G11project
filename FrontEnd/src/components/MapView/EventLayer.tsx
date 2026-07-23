import L from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'

import type { MapEvent } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type EventLayerProps = { events: MapEvent[] }

const warningIcon = L.divIcon({
  className: 'emergency-event-icon',
  html: '<span aria-hidden="true">!</span>',
  iconAnchor: [16, 16],
  iconSize: [32, 32],
})

export function EventLayer({ events }: EventLayerProps) {
  return events.map((event) => (
    <Marker key={event.id} position={toMapPosition(event.x, event.y)} icon={warningIcon}>
      <Tooltip direction="top" offset={[0, -14]}>
        <strong>急刹事件</strong><br />时间：{event.timestamp.toFixed(1)}s
      </Tooltip>
    </Marker>
  ))
}
