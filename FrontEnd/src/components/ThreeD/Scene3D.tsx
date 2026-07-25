import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import type { AnimationChannel } from '../../engine/AnimationEngine'
import type { CameraCommand } from '../../engine/CameraController'
import { easeInOutCubic } from '../../engine/Interpolator'
import type {
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import { Event3D } from './Event3D'
import { RadarScanEffect3D } from '../effects/RadarScanEffect3D'
import { ShockwaveEffect3D } from '../effects/ShockwaveEffect3D'
import { Message3D } from './Message3D'
import { Road3D, type SceneLayout } from './Road3D'
import { Vehicle3D } from './Vehicle3D'

type Scene3DProps = {
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  layout?: SceneLayout
  headingId?: string
  title?: string
  eyebrow?: string
  animationChannel?: AnimationChannel
  candidateIds?: string[]
  effectMode?: 'idle' | 'event' | 'scan' | 'all'
  cameraCommand?: CameraCommand | null
  onManualCamera?: () => void
  secondaryMessages?: SimulationTransmission[]
  secondaryAnimationChannel?: AnimationChannel
}

function CameraRig({ command, urban }: { command: CameraCommand | null; urban: boolean }) {
  const { camera } = useThree()
  const flight = useRef<{
    id: number
    from: Vector3
    to: Vector3
    focus: Vector3
    startedAt: number
    durationMs: number
  } | null>(null)
  useEffect(() => {
    if (!command || command.visualization !== '3d') return
    const focus = command.event
      ? new Vector3(command.event.x * 0.02, 0, command.event.y * 0.02)
      : new Vector3(50, 0, urban ? 10 : 0)
    const to = command.global
      ? new Vector3(50, urban ? 52 : 42, urban ? 42 : 26)
      : new Vector3(focus.x - 10, 16, focus.z + 13)
    flight.current = {
      id: command.id,
      from: camera.position.clone(),
      to,
      focus,
      startedAt: performance.now(),
      durationMs: command.durationMs,
    }
  }, [camera, command, urban])
  useFrame(() => {
    const current = flight.current
    if (!current) return
    const progress = Math.min(1, (performance.now() - current.startedAt) / current.durationMs)
    const curved = easeInOutCubic(progress)
    camera.position.lerpVectors(current.from, current.to, curved)
    camera.position.y += Math.sin(Math.PI * progress) * 3
    camera.lookAt(current.focus)
    if (progress >= 1) flight.current = null
  })
  return null
}

export function Scene3D({
  vehicles,
  events,
  messages,
  layout = 'highway',
  headingId = 'scene-3d-heading',
  title = '3D通信态势',
  eyebrow = 'LIVE 3D OVERVIEW',
  animationChannel = 'single',
  candidateIds = [],
  effectMode = 'all',
  cameraCommand = null,
  onManualCamera,
  secondaryMessages = [],
  secondaryAnimationChannel,
}: Scene3DProps) {
  const urban = layout === 'urban'
  return (
    <section className="map-card scene-card" aria-labelledby={headingId}>
      <div className="section-heading">
        <div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div>
        <div className="legend" aria-label="车辆状态图例">
          <span><i className="legend-dot normal" />正常</span>
          <span><i className="legend-dot sending" />发送</span>
          <span><i className="legend-dot receiving" />接收</span>
        </div>
      </div>
      <div className="scene-3d" data-testid="scene-3d">
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: urban ? [50, 52, 42] : [50, 42, 26], fov: 45, near: 0.1, far: 500 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#07111f']} />
          <fog attach="fog" args={['#07111f', 85, 180]} />
          <ambientLight intensity={1.25} />
          <directionalLight position={[35, 55, 20]} intensity={2.2} />
          <CameraRig command={cameraCommand} urban={urban} />
          <Suspense fallback={null}>
            <Grid
              position={[50, -0.14, urban ? 10 : 0]}
              args={[120, urban ? 36 : 22]}
              cellSize={1}
              cellThickness={0.45}
              cellColor="#17324b"
              sectionSize={5}
              sectionThickness={0.8}
              sectionColor="#24506f"
              fadeDistance={100}
              infiniteGrid={false}
            />
            <Road3D layout={layout} />
            {vehicles.map((vehicle) => <Vehicle3D key={vehicle.id} vehicle={vehicle} animationChannel={animationChannel} />)}
            {events.map((event) => <Event3D key={event.id} event={event} />)}
            <ShockwaveEffect3D events={events} animationChannel={animationChannel}
              active={effectMode === 'event' || effectMode === 'all'} />
            <RadarScanEffect3D events={events} vehicles={vehicles} candidateIds={candidateIds}
              animationChannel={animationChannel} active={effectMode === 'scan' || effectMode === 'all'} />
            <Message3D messages={messages} vehicles={vehicles} animationChannel={animationChannel}
              tone={animationChannel === 'comparison-baseline' ? 'baseline' : 'ai'} />
            {secondaryAnimationChannel && <Message3D messages={secondaryMessages} vehicles={vehicles}
              animationChannel={secondaryAnimationChannel} tone="baseline" />}
          </Suspense>
          <OrbitControls
            makeDefault
            target={[50, 0, urban ? 10 : 0]}
            minDistance={12}
            maxDistance={150}
            maxPolarAngle={Math.PI / 2.08}
            enableDamping
            onStart={onManualCamera}
          />
        </Canvas>
      </div>
    </section>
  )
}
