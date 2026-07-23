import { Polyline, Tooltip } from 'react-leaflet'

import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type MessageLayerProps = { messages: SimulationTransmission[]; vehicles: SimulationVehicle[] }

export function MessageLayer({ messages, vehicles }: MessageLayerProps) {
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  return messages.map((message, index) => {
    const sender = vehiclesById.get(message.from)
    const receiver = vehiclesById.get(message.to)
    if (!sender || !receiver) return null
    const color = message.status === 'success' ? '#10b981' : '#ef4444'

    return (
      <Polyline
        key={`${message.from}-${message.to}-${index}`}
        positions={[
          toMapPosition(sender.x, sender.y),
          toMapPosition(receiver.x, receiver.y),
        ]}
        pathOptions={{ color, opacity: 0.9, weight: 4 }}
        className={`message-path message-path--${message.status}`}
      >
        <Tooltip sticky>
          {message.from} → {message.to} ·{' '}
          {message.status === 'success' ? '成功送达' : '传输超时'} · {message.delay_ms.toFixed(1)} ms
        </Tooltip>
      </Polyline>
    )
  })
}
