import { interpolateRgb } from 'd3'
import { CircleMarker, Tooltip } from 'react-leaflet'

import type { AttentionWeight, SimulationVehicle } from '../../types/simulation'
import { toMapPosition } from './coordinates'

type AttentionHeatmapProps = {
  attentionWeights: AttentionWeight[]
  vehicles: SimulationVehicle[]
}

const attentionColor = interpolateRgb('#2563eb', '#ef4444')

export function AttentionHeatmap({ attentionWeights, vehicles }: AttentionHeatmapProps) {
  const maxByVehicle = new Map<string, number>()
  for (const item of attentionWeights) {
    const vehicleId = String(item.vehicle_id)
    maxByVehicle.set(vehicleId, Math.max(maxByVehicle.get(vehicleId) ?? 0, item.weight))
  }

  return vehicles.map((vehicle) => {
    const weight = Math.max(0, Math.min(1, maxByVehicle.get(String(vehicle.id)) ?? 0))
    if (weight <= 0) return null
    return (
      <CircleMarker
        key={`attention-${vehicle.id}`}
        center={toMapPosition(vehicle.x, vehicle.y)}
        radius={12 + weight * 14}
        pathOptions={{
          color: attentionColor(weight),
          fillColor: attentionColor(weight),
          fillOpacity: 0.18 + weight * 0.38,
          opacity: 0.4 + weight * 0.5,
          weight: 2,
        }}
        className="attention-halo"
      >
        <Tooltip direction="top">
          {vehicle.id} · 相对注意力 {(weight * 100).toFixed(0)}%
        </Tooltip>
      </CircleMarker>
    )
  })
}
