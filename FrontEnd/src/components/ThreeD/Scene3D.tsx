import { OrbitControls, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  MathUtils,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

import {
  presentationCueAt,
  type CameraShot,
  type PresentationStage,
} from '../Presentation/presentationTimeline'
import type { AnimationChannel } from '../../engine/AnimationEngine'
import type {
  SimulationEvent,
  SimulationTransmission,
  SimulationVehicle,
} from '../../types/simulation'
import { useAnimationRuntime } from '../../runtime/AnimationRuntimeContext'
import { ShockwaveEffect3D } from '../effects/ShockwaveEffect3D'
import { Message3D } from './Message3D'
import { Road3D } from './Road3D'
import { toScenePosition } from './sceneCoordinates'
import { VehicleFleet3D } from './VehicleFleet3D'
import {
  beginManualCamera,
  cameraCountdownMs,
  cameraStateAt,
  endManualCamera,
  type CameraControlMode,
  type CameraControlState,
} from './cameraControl'

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
  elapsedMs?: number
  priorityByVehicle?: Readonly<Record<string, number>>
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
  showCameraControls?: boolean
}

type CameraStatus = { mode: CameraControlMode; remainingMs: number }

function FollowCameraRig({ focus, shot, followVehicleId, animationChannel, resetToken, onStatus }: {
  focus: Vector3
  shot: CameraShot
  followVehicleId: string | null
  animationChannel: AnimationChannel
  resetToken: number
  onStatus: (status: CameraStatus) => void
}) {
  const { camera } = useThree()
  const { animation } = useAnimationRuntime()
  const controls = useRef<OrbitControlsImpl>(null)
  const target = useRef(focus.clone())
  const previousTarget = useRef(focus.clone())
  const desired = useRef(new Vector3())
  const returnPosition = useRef(new Vector3())
  const state = useRef<CameraControlState>({ mode: 'directed', resumeAtMs: null })
  const lastReport = useRef(0)

  useEffect(() => {
    target.current.copy(focus)
    previousTarget.current.copy(focus)
  }, [focus])

  useEffect(() => {
    state.current = { mode: 'returning', resumeAtMs: null }
    onStatus({ mode: 'returning', remainingMs: 0 })
  }, [onStatus, resetToken])

  useFrame((_, delta) => {
    const animated = followVehicleId ? animation.getVehicle(animationChannel, followVehicleId) : null
    if (animated) target.current.set(...toScenePosition(animated.x, animated.y, 'highway'))
    else target.current.copy(focus)
    const deltaTarget = desired.current.copy(target.current).sub(previousTarget.current)
    const now = performance.now()
    state.current = cameraStateAt(state.current, now)
    if (state.current.mode === 'manual_follow') {
      camera.position.add(deltaTarget)
      if (controls.current) {
        controls.current.target.add(deltaTarget)
        controls.current.update()
      }
    } else {
      const returning = state.current.mode === 'returning'
      desired.current.set(
        target.current.x + shot.offset[0],
        shot.offset[1],
        target.current.z + shot.offset[2],
      )
      const amount = 1 - Math.exp(-delta * (returning ? 3.4 : 2.45))
      camera.position.lerp(desired.current, amount)
      desired.current.set(target.current.x + shot.lookAhead, target.current.y + 0.18, target.current.z)
      if (controls.current) {
        controls.current.target.lerp(desired.current, amount)
        controls.current.update()
      } else camera.lookAt(desired.current)
      if ('fov' in camera) {
        camera.fov = MathUtils.lerp(camera.fov, shot.fov, amount)
        camera.updateProjectionMatrix()
      }
      returnPosition.current.set(
        target.current.x + shot.offset[0], shot.offset[1], target.current.z + shot.offset[2],
      )
      if (returning && camera.position.distanceTo(returnPosition.current) < 0.08) {
        state.current = { mode: 'directed', resumeAtMs: null }
        onStatus({ mode: 'directed', remainingMs: 0 })
      }
    }
    previousTarget.current.copy(target.current)
    if (now - lastReport.current > 200) {
      lastReport.current = now
      onStatus({ mode: state.current.mode, remainingMs: cameraCountdownMs(state.current, now) })
    }
  })

  const startManual = () => {
    state.current = beginManualCamera()
    onStatus({ mode: 'manual_follow', remainingMs: 0 })
  }
  const endManual = () => {
    state.current = endManualCamera(performance.now())
    onStatus({ mode: 'manual_follow', remainingMs: 6_000 })
  }

  return <OrbitControls ref={controls} makeDefault target={target.current.toArray()}
    enableRotate enableZoom enablePan={false} minDistance={3.8} maxDistance={70}
    maxPolarAngle={Math.PI / 2.08} enableDamping onStart={startManual} onEnd={endManual} />
}

function IncidentAnalysis3D({ focus, progress }: { focus: Vector3; progress: number }) {
  if (progress <= 0) return null
  const length = 4.8 * progress
  return (
    <group position={[focus.x - length / 2 - 0.32, 0.045, focus.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[length, 0.82]} />
        <meshBasicMaterial color="#e94343" transparent opacity={0.13} depthWrite={false} />
      </mesh>
      {[-0.41, 0.41].map((z) => (
        <mesh key={z} position={[0, 0.008, z]} renderOrder={3}>
          <boxGeometry args={[length, 0.012, 0.018]} />
          <meshBasicMaterial color="#ff8a74" transparent opacity={0.64} depthWrite={false} />
        </mesh>
      ))}
      {[0.18, 0.42, 0.66, 0.9].map((ratio) => (
        <mesh key={ratio} position={[length / 2 - length * ratio, 0.012, 0]} rotation={[0, Math.PI / 4, 0]}>
          <boxGeometry args={[0.22, 0.014, 0.025]} />
          <meshBasicMaterial color="#ffd1c7" transparent opacity={0.48} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
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
  elapsedMs = 0,
  priorityByVehicle = {},
  interactive = false,
  onVehicleSelect,
  showCameraControls = true,
}: Scene3DProps) {
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ mode: 'directed', remainingMs: 0 })
  const [cameraFollow, setCameraFollow] = useState<'accident' | 'selected'>('accident')
  const cue = useMemo(() => presentationCueAt(elapsedMs), [elapsedMs])
  const focus = useMemo(() => {
    const selected = vehicles.find((vehicle) => vehicle.id === (accidentVehicleId ?? selectedVehicleId))
    const event = events[0]
    if (event) return new Vector3(...toScenePosition(event.x, event.y, 'highway'))
    if (selected) return new Vector3(...toScenePosition(selected.x, selected.y, 'highway'))
    const ordered = vehicles.map((vehicle) => vehicle.x).sort((left, right) => left - right)
    return new Vector3(...toScenePosition(ordered[Math.floor(ordered.length / 2)] ?? 1000, -4.8, 'highway'))
  }, [accidentVehicleId, events, selectedVehicleId, vehicles])
  const showEvent = stage !== 'normal' && stage !== 'summary' && events.length > 0
  const showShockwave = stage === 'accident' && cue.stageProgress < 0.42

  return (
    <div className="presentation-scene" data-testid="scene-3d" aria-label="三维高速公路通信演示">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.6]}
        camera={{ position: [focus.x - 4.8, 4.8, focus.z + 6.9], fov: 40, near: 0.05, far: 650 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = 0.98
          gl.setClearColor(new Color('#9aafbd'))
        }}
      >
        <fog attach="fog" args={['#a6b4bb', 72, 250]} />
        <Sky distance={420} sunPosition={[65, 30, -26]} inclination={0.49} azimuth={0.2}
          turbidity={4.5} rayleigh={1.18} mieCoefficient={0.006} mieDirectionalG={0.76} />
        <hemisphereLight args={['#edf6fa', '#435047', 1.52]} />
        <ambientLight color="#dce8ed" intensity={0.26} />
        <directionalLight castShadow position={[focus.x - 13, 25, 14]} intensity={3.05}
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-near={1} shadow-camera-far={70}
          shadow-camera-left={-32} shadow-camera-right={32}
          shadow-camera-top={25} shadow-camera-bottom={-25} />
        <FollowCameraRig focus={focus} shot={cue.camera}
          followVehicleId={(cameraFollow === 'selected' ? selectedVehicleId : accidentVehicleId)
            ?? accidentVehicleId ?? selectedVehicleId ?? null}
          animationChannel={animationChannel} resetToken={cameraResetToken} onStatus={setCameraStatus} />
        <Suspense fallback={null}>
          <Road3D layout="highway" />
          <VehicleFleet3D vehicles={vehicles} animationChannel={animationChannel}
            selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
            relevantIds={candidateIds} notifiedIds={notifiedIds}
            stage={stage} elapsedMs={elapsedMs}
            interactive={interactive} onVehicleSelect={onVehicleSelect} />
          <IncidentAnalysis3D focus={focus} progress={cue.riskProgress} />
          <ShockwaveEffect3D events={showEvent ? events : []} animationChannel={animationChannel}
            active={showShockwave} layout="highway" />
          <Message3D messages={messages} vehicles={vehicles} animationChannel={animationChannel}
            tone={messageTone} layout="highway" revealProgress={cue.linkRevealProgress}
            priorityByVehicle={priorityByVehicle} />
        </Suspense>
      </Canvas>
      {showCameraControls && <div className="camera-control-status" aria-live="polite">
        <span>{cameraStatus.mode === 'directed' ? '自动机位'
          : cameraStatus.mode === 'returning' ? '正在恢复视角'
            : cameraStatus.remainingMs > 0 ? `自由观察 ${(cameraStatus.remainingMs / 1000).toFixed(1)}s` : '自由观察'}</span>
        <button type="button" className={cameraFollow === 'accident' ? 'is-active' : ''}
          onClick={() => { setCameraFollow('accident'); setCameraResetToken((value) => value + 1) }}>跟随事故车</button>
        {selectedVehicleId && selectedVehicleId !== accidentVehicleId && <button type="button"
          className={cameraFollow === 'selected' ? 'is-active' : ''}
          onClick={() => { setCameraFollow('selected'); setCameraResetToken((value) => value + 1) }}>跟随当前车辆</button>}
        <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>恢复推荐视角</button>
      </div>}
    </div>
  )
}
