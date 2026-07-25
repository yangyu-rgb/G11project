import { lazy, Suspense } from 'react'

import type {
  AttentionWeight,
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../types/simulation'
import type { AnimationChannel } from '../engine/AnimationEngine'
import type { CameraCommand } from '../engine/CameraController'
import { MapView } from './MapView/MapView'
import type { SceneLayout } from './ThreeD/Road3D'

const Scene3D = lazy(() => import('./ThreeD/Scene3D').then((module) => ({
  default: module.Scene3D,
})))

export type VisualizationMode = '2d' | '3d'

type SimulationViewportProps = {
  visualization: VisualizationMode
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  attentionWeights?: AttentionWeight[]
  layout?: SceneLayout
  headingId?: string
  title?: string
  eyebrow?: string
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

export function SimulationViewport({ visualization, ...props }: SimulationViewportProps) {
  if (visualization === '3d') {
    return <Suspense fallback={<section className="map-card scene-loading" aria-live="polite">正在加载3D场景…</section>}>
      <Scene3D
        vehicles={props.vehicles}
        events={props.events}
        messages={props.messages}
        layout={props.layout}
        headingId={props.headingId}
        title={props.title}
        eyebrow={props.eyebrow}
        animationChannel={props.animationChannel}
        candidateIds={props.candidateIds}
        effectMode={props.effectMode}
        cameraCommand={props.cameraCommand}
        onManualCamera={props.onManualCamera}
      />
    </Suspense>
  }
  return <MapView {...props} />
}
