import { Polyline, Tooltip } from 'react-leaflet'

import type { MapMessage, MapVehicle } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type MessageLayerProps = { messages: MapMessage[]; vehicles: MapVehicle[] }

export function MessageLayer({ messages, vehicles }: MessageLayerProps) {
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  return messages.map((message) => {
    const sender = vehiclesById.get(message.senderId)
    const receiver = vehiclesById.get(message.receiverId)
    if (!sender || !receiver) return null
    const color = message.status === 'success' ? '#10b981' : '#ef4444'

    return (
      <Polyline
        key={message.id}
        positions={[
          toMapPosition(sender.x, sender.y),
          toMapPosition(receiver.x, receiver.y),
        ]}
        pathOptions={{ color, opacity: 0.9, weight: 4 }}
        className={`message-path message-path--${message.status}`}
      >
        <Tooltip sticky>
          {message.senderId} → {message.receiverId} ·{' '}
          {message.status === 'success' ? '成功送达' : '传输超时'}
        </Tooltip>
      </Polyline>
    )
  })
}
