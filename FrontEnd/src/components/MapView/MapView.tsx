import L, { type LatLngBoundsExpression } from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'

import {
  BASE_MAPS,
  MAP_DETAIL_ZOOM_THRESHOLD,
  MAP_NOTICE,
  MAP_ORIGIN,
  type BaseMapStyle,
} from '../../config/mapConfig'
import type {
  AttentionWeight,
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import type { AnimationChannel } from '../../engine/AnimationEngine'
import type { CameraCommand } from '../../engine/CameraController'
import type { SceneLayout } from '../ThreeD/Road3D'
import { RadarScanEffect2D } from '../effects/RadarScanEffect'
import { ShockwaveEffect2D } from '../effects/ShockwaveEffect'
import { AttentionHeatmap } from './AttentionHeatmap'
import { AttentionLinks } from './AttentionLinks'
import { EventLayer } from './EventLayer'
import { MessageLayer } from './MessageLayer'
import { VehicleLayer } from './VehicleLayer'
import { toMapPosition } from './coordinates'

type MapViewProps = {
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  attentionWeights?: AttentionWeight[]
  headingId?: string
  title?: string
  eyebrow?: string
  layout?: SceneLayout
  editing?: boolean
  onMapClick?: (latitude: number, longitude: number) => void
  onVehicleSelect?: (vehicle: SimulationVehicle) => void
  onEventSelect?: (event: SimulationEvent) => void
  onTileError?: (message: string) => void
  animationChannel?: AnimationChannel
  candidateIds?: string[]
  effectMode?: 'idle' | 'event' | 'scan' | 'all'
  cameraCommand?: CameraCommand | null
  onManualCamera?: () => void
  secondaryMessages?: SimulationTransmission[]
  secondaryAnimationChannel?: AnimationChannel
}

function roadLines(layout: SceneLayout): [number, number][][] {
  if (layout === 'urban') {
    return [
      [[0, 500], [5000, 500]],
      [[1000, 0], [1000, 1000]],
      [[2500, 0], [2500, 1000]],
      [[4000, 0], [4000, 1000]],
    ]
  }
  return [-3.2, -6.4, -9.6].map((y) => [[0, y], [5000, y]])
}

function FitScenarioBounds({
  vehicles,
  events,
  layout,
}: Pick<MapViewProps, 'vehicles' | 'events' | 'layout'>) {
  const map = useMap()
  const lastSignature = useRef('')
  const signature = `${layout}:${vehicles.map((item) => item.id).join(',')}:${events.map((item) => item.id).join(',')}`

  useEffect(() => {
    if (signature === lastSignature.current) return
    lastSignature.current = signature
    const positions = [
      ...vehicles.map((item) => toMapPosition(item.x, item.y)),
      ...events.map((item) => toMapPosition(item.x, item.y)),
    ]
    if (positions.length === 0) {
      positions.push(toMapPosition(0, -20), toMapPosition(5000, layout === 'urban' ? 1020 : 20))
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [34, 34], maxZoom: 16, animate: false })
  }, [events, layout, map, signature, vehicles])
  return null
}

function MapInteraction({
  editing,
  onMapClick,
  onDetailChange,
}: Pick<MapViewProps, 'editing' | 'onMapClick'> & { onDetailChange: (visible: boolean) => void }) {
  useMapEvents({
    click(event) {
      if (editing) onMapClick?.(event.latlng.lat, event.latlng.lng)
    },
    zoomend(event) {
      onDetailChange(event.target.getZoom() >= MAP_DETAIL_ZOOM_THRESHOLD)
    },
  })
  return null
}

function CameraBridge({ command, vehicles, events, layout }: {
  command: CameraCommand | null
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  layout: SceneLayout
}) {
  const map = useMap()
  const lastCommand = useRef(0)
  useEffect(() => {
    if (!command || command.visualization !== '2d') return
    if (lastCommand.current === command.id) return
    lastCommand.current = command.id
    if (command.global) {
      const positions = [...vehicles.map((vehicle) => toMapPosition(vehicle.x, vehicle.y)),
        ...events.map((event) => toMapPosition(event.x, event.y))]
      if (!positions.length) positions.push(toMapPosition(0, -20), toMapPosition(5000, layout === 'urban' ? 1020 : 20))
      map.flyToBounds(L.latLngBounds(positions), { duration: command.durationMs / 1000, padding: [34, 34], maxZoom: 16 })
    } else if (command.event) {
      map.flyTo(toMapPosition(command.event.x, command.event.y), 16, { duration: command.durationMs / 1000 })
    }
  }, [command, events, layout, map, vehicles])
  return null
}

function ManualCameraBridge({ onManualCamera }: { onManualCamera?: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (!onManualCamera) return
    const container = map.getContainer()
    container.addEventListener('pointerdown', onManualCamera)
    container.addEventListener('wheel', onManualCamera, { passive: true })
    return () => {
      container.removeEventListener('pointerdown', onManualCamera)
      container.removeEventListener('wheel', onManualCamera)
    }
  }, [map, onManualCamera])
  return null
}

export function MapView({
  vehicles,
  events,
  messages,
  attentionWeights = [],
  headingId = 'map-heading',
  title = '道路通信态势',
  eyebrow = 'LIVE GEO MAP',
  layout = 'highway',
  editing = false,
  onMapClick,
  onVehicleSelect,
  onEventSelect,
  onTileError,
  animationChannel = 'single',
  candidateIds = [],
  effectMode = 'all',
  cameraCommand = null,
  onManualCamera,
  secondaryMessages = [],
  secondaryAnimationChannel,
}: MapViewProps) {
  const [attentionEnabled, setAttentionEnabled] = useState(true)
  const [baseMap, setBaseMap] = useState<BaseMapStyle>('street')
  const [detailsVisible, setDetailsVisible] = useState(true)
  const tileFailureReported = useRef(false)
  const lines = useMemo(() => roadLines(layout), [layout])
  const defaultBounds: LatLngBoundsExpression = [toMapPosition(0, -20), toMapPosition(5000, layout === 'urban' ? 1020 : 20)]
  const selectedBaseMap = BASE_MAPS[baseMap]

  const handleTileError = () => {
    if (tileFailureReported.current) return
    tileFailureReported.current = true
    if (baseMap === 'satellite') setBaseMap('street')
    onTileError?.(`${selectedBaseMap.label}加载失败${baseMap === 'satellite' ? '，已回退街道图' : ''}`)
  }

  return (
    <section className={`map-card${editing ? ' map-card--editing' : ''}`} aria-labelledby={headingId}>
      <div className="section-heading">
        <div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2><small>{MAP_NOTICE}</small></div>
        <div className="map-heading-actions">
          <div className="legend" aria-label="车辆状态图例">
            <span><i className="legend-dot normal" />正常</span>
            <span><i className="legend-dot sending" />发送</span>
            <span><i className="legend-dot receiving" />接收</span>
          </div>
          <label className="basemap-select">
            底图
            <select value={baseMap} onChange={(event) => {
              tileFailureReported.current = false
              setBaseMap(event.target.value as BaseMapStyle)
            }}>
              {Object.entries(BASE_MAPS).map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`attention-toggle${attentionEnabled ? ' attention-toggle--active' : ''}`}
            role="switch"
            aria-checked={attentionEnabled}
            onClick={() => setAttentionEnabled((enabled) => !enabled)}
          >
            注意力图层 {attentionEnabled ? '开' : '关'}
          </button>
        </div>
      </div>
      <MapContainer
        className={`highway-map highway-map--${baseMap}`}
        center={MAP_ORIGIN}
        bounds={defaultBounds}
        minZoom={11}
        maxZoom={19}
        zoomControl={false}
        attributionControl
        preferCanvas
      >
        <TileLayer
          key={baseMap}
          url={selectedBaseMap.url}
          attribution={selectedBaseMap.attribution}
          maxZoom={selectedBaseMap.maxZoom}
          eventHandlers={{ tileerror: handleTileError }}
        />
        <ZoomControl position="bottomright" />
        <FitScenarioBounds vehicles={vehicles} events={events} layout={layout} />
        <MapInteraction editing={editing} onMapClick={onMapClick} onDetailChange={setDetailsVisible} />
        <CameraBridge command={cameraCommand} vehicles={vehicles} events={events} layout={layout} />
        <ManualCameraBridge onManualCamera={onManualCamera} />
        {lines.map((line, index) => (
          <Polyline
            key={`${layout}-${index}`}
            positions={line.map(([x, y]) => toMapPosition(x, y))}
            pathOptions={{ color: '#dbeafe', weight: 2, opacity: 0.72, dashArray: '12 12' }}
          />
        ))}
        {detailsVisible && attentionEnabled && <AttentionHeatmap attentionWeights={attentionWeights} vehicles={vehicles} />}
        {detailsVisible && attentionEnabled && (
          <AttentionLinks attentionWeights={attentionWeights} events={events} vehicles={vehicles} />
        )}
        {detailsVisible && <MessageLayer messages={messages} vehicles={vehicles}
          animationChannel={animationChannel} tone={animationChannel === 'comparison-baseline' ? 'baseline' : 'ai'} />}
        {detailsVisible && secondaryAnimationChannel && <MessageLayer messages={secondaryMessages} vehicles={vehicles}
          animationChannel={secondaryAnimationChannel} tone="baseline" />}
        <ShockwaveEffect2D events={events} animationChannel={animationChannel}
          active={effectMode === 'event' || effectMode === 'all'} />
        <RadarScanEffect2D events={events} vehicles={vehicles} candidateIds={candidateIds}
          animationChannel={animationChannel} active={effectMode === 'scan' || effectMode === 'all'} />
        <VehicleLayer vehicles={vehicles} animationChannel={animationChannel} onVehicleSelect={onVehicleSelect} />
        <EventLayer events={events} onEventSelect={onEventSelect} />
      </MapContainer>
    </section>
  )
}
