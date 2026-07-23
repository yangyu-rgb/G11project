import { Polyline, Tooltip } from 'react-leaflet'

import type { AttentionWeight, SimulationEvent, SimulationVehicle } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type AttentionLinksProps = {
  attentionWeights: AttentionWeight[]
  events: SimulationEvent[]
  vehicles: SimulationVehicle[]
}

const LINK_THRESHOLD = 0.6

export function AttentionLinks({ attentionWeights, events, vehicles }: AttentionLinksProps) {
  const vehiclesById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]))
  const eventsById = new Map(events.map((event) => [String(event.id), event]))

  return attentionWeights.map((item) => {
    if (item.weight <= LINK_THRESHOLD) return null
    const vehicle = vehiclesById.get(String(item.vehicle_id))
    const event = eventsById.get(String(item.event_id))
    if (!vehicle || !event) return null
    return (
      <Polyline
        key={`attention-link-${item.event_id}-${item.vehicle_id}`}
        positions={[toMapPosition(event.x, event.y), toMapPosition(vehicle.x, vehicle.y)]}
        pathOptions={{
          color: '#fb7185',
          opacity: 0.3 + item.weight * 0.65,
          weight: 1.5 + item.weight * 5,
          dashArray: '8 7',
        }}
        className="attention-link"
      >
        <Tooltip sticky>
          事件 {item.event_id} → {item.vehicle_id} · 相对注意力 {(item.weight * 100).toFixed(0)}%
        </Tooltip>
      </Polyline>
    )
  })
}
