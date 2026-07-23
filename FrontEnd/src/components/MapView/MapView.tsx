import L from 'leaflet'
import { MapContainer, Polyline, ZoomControl } from 'react-leaflet'

import type {
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import { EventLayer } from './EventLayer'
import { MessageLayer } from './MessageLayer'
import { VehicleLayer } from './VehicleLayer'

type MapViewProps = {
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
}

const ROAD_BOUNDS = L.latLngBounds([-100, 0], [260, 5000])
const LANES = [0, 80, 160]

export function MapView({ vehicles, events, messages }: MapViewProps) {
  return (
    <section className="map-card" aria-labelledby="map-heading">
      <div className="section-heading">
        <div><p className="eyebrow">LIVE HIGHWAY</p><h2 id="map-heading">高速公路通信态势</h2></div>
        <div className="legend" aria-label="车辆状态图例">
          <span><i className="legend-dot normal" />正常</span>
          <span><i className="legend-dot sending" />发送</span>
          <span><i className="legend-dot receiving" />接收</span>
        </div>
      </div>
      <MapContainer
        className="highway-map"
        crs={L.CRS.Simple}
        bounds={ROAD_BOUNDS}
        maxBounds={L.latLngBounds([-350, -250], [510, 5250])}
        minZoom={-2}
        maxZoom={3}
        zoomControl={false}
        attributionControl={false}
      >
        <ZoomControl position="bottomright" />
        {LANES.map((y) => (
          <Polyline key={y} positions={[[y, 0], [y, 5000]]} pathOptions={{ color: '#94a3b8', weight: 2, dashArray: '14 14' }} />
        ))}
        <MessageLayer messages={messages} vehicles={vehicles} />
        <VehicleLayer vehicles={vehicles} />
        <EventLayer events={events} />
      </MapContainer>
    </section>
  )
}
