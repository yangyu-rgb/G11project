import { CircleMarker, Tooltip } from 'react-leaflet'

import type { MapVehicle, VehicleStatus } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type VehicleLayerProps = { vehicles: MapVehicle[] }

const colors: Record<VehicleStatus, string> = {
  normal: '#3282f6',
  sending: '#10b981',
  receiving: '#f59e0b',
}

const labels: Record<VehicleStatus, string> = {
  normal: '正常',
  sending: '发送消息',
  receiving: '接收消息',
}

export function VehicleLayer({ vehicles }: VehicleLayerProps) {
  return vehicles.map((vehicle) => (
    <CircleMarker
      key={vehicle.id}
      center={toMapPosition(vehicle.x, vehicle.y)}
      radius={vehicle.status === 'sending' ? 10 : 8}
      pathOptions={{
        color: '#ffffff',
        fillColor: colors[vehicle.status],
        fillOpacity: 1,
        weight: 2,
      }}
    >
      <Tooltip direction="top" offset={[0, -8]}>
        <strong>{vehicle.id}</strong><br />
        {vehicle.speedKmh} km/h · {labels[vehicle.status]}
      </Tooltip>
    </CircleMarker>
  ))
}
