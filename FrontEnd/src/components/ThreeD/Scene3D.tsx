import { OrbitControls, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  SRGBColorSpace,
  Vector3,
} from 'three'

import type { PresentationStage } from '../Presentation/presentationTimeline'
import type { AnimationChannel } from '../../engine/AnimationEngine'
import type {
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import { ShockwaveEffect3D } from '../effects/ShockwaveEffect3D'
import { Event3D } from './Event3D'
import { Message3D } from './Message3D'
import { Road3D } from './Road3D'
import { toScenePosition } from './sceneCoordinates'
import { VehicleFleet3D } from './VehicleFleet3D'

type Scene3DProps = {
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  animationChannel?: AnimationChannel
  messageTone?: 'ai' | 'baseline'
  candidateIds?: string[]
  notifiedIds?: string[]
  selectedVehicleId?: string | null
  accidentVehicleId?: string | null
  stage?: PresentationStage
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
}

function CameraRig({ focus, stage, interactive }: {
  focus: Vector3
  stage: PresentationStage
  interactive: boolean
}) {
  const { camera } = useThree()
  const target = useRef(focus.clone())
  const desired = useRef(new Vector3())

  useEffect(() => {
    target.current.copy(focus)
  }, [focus])

  useFrame((_, delta) => {
    if (interactive) return
    const distance = stage === 'accident' ? [-2.4, 2.7, 3.2]
      : stage === 'normal' ? [-4.2, 5.2, 6.5]
        : [-3.2, 5.8, 7.6]
    desired.current.set(
      target.current.x + distance[0],
      distance[1],
      target.current.z + distance[2],
    )
    const amount = 1 - Math.exp(-delta * 2.8)
    camera.position.lerp(desired.current, amount)
    camera.lookAt(target.current)
  })
  return null
}

export function Scene3D({
  vehicles,
  events,
  messages,
  animationChannel = 'comparison-ai',
  messageTone = 'ai',
  candidateIds = [],
  notifiedIds = [],
  selectedVehicleId,
  accidentVehicleId,
  stage = 'normal',
  interactive = false,
  onVehicleSelect,
}: Scene3DProps) {
  const focus = useMemo(() => {
    const selected = vehicles.find((vehicle) => vehicle.id === (accidentVehicleId ?? selectedVehicleId))
    const event = events[0]
    if (event) return new Vector3(...toScenePosition(event.x, event.y, 'highway'))
    if (selected) return new Vector3(...toScenePosition(selected.x, selected.y, 'highway'))
    const ordered = vehicles.map((vehicle) => vehicle.x).sort((left, right) => left - right)
    return new Vector3(...toScenePosition(ordered[Math.floor(ordered.length / 2)] ?? 1000, -4.8, 'highway'))
  }, [accidentVehicleId, events, selectedVehicleId, vehicles])
  const showEvent = stage !== 'normal' && stage !== 'summary' && events.length > 0
  const showShockwave = stage === 'accident'

  return (
    <div className="presentation-scene" data-testid="scene-3d" aria-label="三维高速公路通信演示">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.6]}
        camera={{ position: [focus.x - 4.2, 5.2, focus.z + 6.5], fov: 42, near: 0.05, far: 650 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
          gl.setClearColor(new Color('#8ca6bd'))
        }}
      >
        <fog attach="fog" args={['#a8bac8', 75, 260]} />
        <Sky distance={420} sunPosition={[70, 28, -20]} inclination={0.46} azimuth={0.19}
          turbidity={5} rayleigh={1.2} mieCoefficient={0.006} mieDirectionalG={0.78} />
        <hemisphereLight args={['#dcecff', '#34412f', 1.75]} />
        <directionalLight castShadow position={[focus.x - 12, 24, 15]} intensity={3.4}
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-near={1} shadow-camera-far={70}
          shadow-camera-left={-32} shadow-camera-right={32}
          shadow-camera-top={25} shadow-camera-bottom={-25} />
        <CameraRig focus={focus} stage={stage} interactive={interactive} />
        <Suspense fallback={null}>
          <Road3D layout="highway" />
          <VehicleFleet3D vehicles={vehicles} animationChannel={animationChannel}
            selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
            relevantIds={candidateIds} notifiedIds={notifiedIds}
            interactive={interactive} onVehicleSelect={onVehicleSelect} />
          {showEvent && events.map((event) => <Event3D key={event.id} event={event} layout="highway" />)}
          <ShockwaveEffect3D events={showEvent ? events : []} animationChannel={animationChannel}
            active={showShockwave} layout="highway" />
          <Message3D messages={messages} vehicles={vehicles} animationChannel={animationChannel}
            tone={messageTone} layout="highway" />
        </Suspense>
        <OrbitControls enabled={interactive} makeDefault target={focus.toArray()}
          minDistance={3.8} maxDistance={70} maxPolarAngle={Math.PI / 2.08}
          enableDamping enablePan={interactive} />
      </Canvas>
    </div>
  )
}
