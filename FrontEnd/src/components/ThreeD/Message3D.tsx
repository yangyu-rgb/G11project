import { QuadraticBezierLine } from '@react-three/drei'

import type { SimulationTransmission, SimulationVehicle } from '../../types/simulation'
import { toScenePosition } from './sceneCoordinates'

type Message3DProps = {
  messages: SimulationTransmission[]
  vehicles: SimulationVehicle[]
}

export function Message3D({ messages, vehicles }: Message3DProps) {
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  return messages.map((message, index) => {
    const sender = byId.get(message.from)
    const receiver = byId.get(message.to)
    if (!sender || !receiver) return null
    const start = toScenePosition(sender.x, sender.y)
    const end = toScenePosition(receiver.x, receiver.y)
    start[1] = 0.7
    end[1] = 0.7
    const midpoint: [number, number, number] = [
      (start[0] + end[0]) / 2,
      2.4 + Math.hypot(end[0] - start[0], end[2] - start[2]) * 0.08,
      (start[2] + end[2]) / 2,
    ]
    return (
      <QuadraticBezierLine
        key={`${message.from}-${message.to}-${index}`}
        start={start}
        end={end}
        mid={midpoint}
        color={message.status === 'success' ? '#34d399' : '#fb7185'}
        lineWidth={2.2}
        transparent
        opacity={0.88}
      />
    )
  })
}
