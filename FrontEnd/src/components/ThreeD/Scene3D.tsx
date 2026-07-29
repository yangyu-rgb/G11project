import { Environment, Lightformer, OrbitControls, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  MathUtils,
  Object3D,
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
import { enforceHighwaySpacing } from './highwaySpacing'
import {
  HIGHWAY_LANE_CENTERS_METERS,
  HIGHWAY_LANE_WIDTH,
  SCENE_SCALE,
  nearestHighwayLaneIndex,
  toScenePosition,
} from './sceneCoordinates'
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
  freezeEvidenceFrame?: boolean
  corridorRadiusM?: number
  corridorLaneScope?: string
  priorityByVehicle?: Readonly<Record<string, number>>
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
  showCameraControls?: boolean
}

type CameraStatus = { mode: CameraControlMode; remainingMs: number }

function UrbanDaylight({ focus }: { focus: Vector3 }) {
  const sunTarget = useMemo(() => new Object3D(), [])
  return (
    <>
      <primitive object={sunTarget} position={[focus.x + 1.5, 0, focus.z]} />
      <Environment resolution={64} frames={1} environmentIntensity={0.58}>
        <Lightformer form="rect" color="#fff1d6" intensity={3.2}
          position={[-8, 10, -10]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer form="rect" color="#b9d5e3" intensity={1.5}
          position={[10, 5, 4]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 5, 1]} />
        <Lightformer form="ring" color="#dce9ee" intensity={1.1}
          position={[0, 8, 8]} scale={6} />
      </Environment>
      <hemisphereLight args={['#dcecf3', '#59665a', 1.18]} />
      <ambientLight color="#dbe5e8" intensity={0.2} />
      <directionalLight castShadow color="#fff4df" target={sunTarget}
        position={[focus.x - 18, 24, focus.z + 14]} intensity={2.65}
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-near={2} shadow-camera-far={65}
        shadow-camera-left={-26} shadow-camera-right={26}
        shadow-camera-top={22} shadow-camera-bottom={-22}
        shadow-bias={-0.00012} shadow-normalBias={0.035} />
      <directionalLight color="#b8d8e7" position={[focus.x + 20, 9, focus.z - 18]}
        intensity={0.42} />
    </>
  )
}

function FollowCameraRig({ focus, shot, followVehicleId, animationChannel, fixedVehicles, resetToken,
  onStatus }: {
  focus: Vector3
  shot: CameraShot
  followVehicleId: string | null
  animationChannel: AnimationChannel
  fixedVehicles?: readonly SimulationVehicle[]
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
    const animated = followVehicleId
      ? fixedVehicles
        ? fixedVehicles.find((vehicle) => vehicle.id === followVehicleId) ?? null
        : animation.getVehicle(animationChannel, followVehicleId)
      : null
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
    enableRotate enableZoom enablePan={false} minDistance={3.8} maxDistance={140}
    maxPolarAngle={Math.PI / 2.08} enableDamping onStart={startManual} onEnd={endManual} />
}

function CorridorBand({ focus, laneIndex, radiusM, opacity }: {
  focus: Vector3
  laneIndex: number
  radiusM: number
  opacity: number
}) {
  const length = radiusM * SCENE_SCALE
  const laneZ = toScenePosition(0, HIGHWAY_LANE_CENTERS_METERS[laneIndex], 'highway')[2]
  return <group>
    <mesh position={[focus.x - length / 2, 0.042, laneZ]}
      rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[length, HIGHWAY_LANE_WIDTH * 0.9]} />
      <meshBasicMaterial color="#36d7bd" transparent opacity={opacity}
        depthWrite={false} toneMapped={false} />
    </mesh>
    {[0.2, 0.45, 0.7, 0.9].map((ratio) => <mesh key={ratio}
      position={[focus.x - length * ratio, 0.052, laneZ]} rotation={[0, 0, Math.PI / 4]}>
      <boxGeometry args={[0.24, 0.018, 0.035]} />
      <meshBasicMaterial color="#b7fff0" transparent opacity={Math.min(0.9, opacity * 4)}
        depthWrite={false} toneMapped={false} />
    </mesh>)}
  </group>
}

function RiskCorridor3D({ focus, sourceY, radiusM, laneScope }: {
  focus: Vector3
  sourceY: number
  radiusM: number
  laneScope: string
}) {
  const laneIndex = nearestHighwayLaneIndex(sourceY)
  const adjacent = laneScope === 'same_and_adjacent'
    ? [laneIndex - 1, laneIndex + 1].filter((index) => (
      index >= 0 && index < HIGHWAY_LANE_CENTERS_METERS.length
    ))
    : []
  return <group>
    <CorridorBand focus={focus} laneIndex={laneIndex} radiusM={radiusM} opacity={0.2} />
    {adjacent.map((index) => <CorridorBand key={index} focus={focus} laneIndex={index}
      radiusM={radiusM * 0.5} opacity={0.11} />)}
  </group>
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
  freezeEvidenceFrame = false,
  corridorRadiusM,
  corridorLaneScope = 'same',
  priorityByVehicle = {},
  interactive = false,
  onVehicleSelect,
  showCameraControls = true,
}: Scene3DProps) {
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ mode: 'directed', remainingMs: 0 })
  const [cameraFollow, setCameraFollow] = useState<'accident' | 'selected'>('accident')
  const cue = useMemo(() => presentationCueAt(elapsedMs), [elapsedMs])
  const evidenceVehicles = useMemo(() => enforceHighwaySpacing(vehicles), [vehicles])
  const fixedVehicles = freezeEvidenceFrame ? evidenceVehicles : undefined
  const evidenceVehicleIds = useMemo(
    () => new Set(evidenceVehicles.map((vehicle) => vehicle.id)),
    [evidenceVehicles],
  )
  const evidenceError = freezeEvidenceFrame && messages.some((message) => (
    !evidenceVehicleIds.has(message.from) || !evidenceVehicleIds.has(message.to)
  ))
  const focus = useMemo(() => {
    const selected = evidenceVehicles.find(
      (vehicle) => vehicle.id === (accidentVehicleId ?? selectedVehicleId),
    )
    const event = events[0]
    if (event) return new Vector3(...toScenePosition(event.x, event.y, 'highway'))
    if (selected) return new Vector3(...toScenePosition(selected.x, selected.y, 'highway'))
    const ordered = evidenceVehicles.map((vehicle) => vehicle.x).sort((left, right) => left - right)
    return new Vector3(...toScenePosition(ordered[Math.floor(ordered.length / 2)] ?? 1000, -4.8, 'highway'))
  }, [accidentVehicleId, events, evidenceVehicles, selectedVehicleId])
  const overviewFocus = useMemo(() => {
    if (!evidenceVehicles.length) return focus
    const xs = evidenceVehicles.map((vehicle) => vehicle.x)
    return new Vector3(...toScenePosition((Math.min(...xs) + Math.max(...xs)) / 2, -4.8, 'highway'))
  }, [evidenceVehicles, focus])
  const comparisonOverview = stage === 'broadcast' || (stage === 'ai' && elapsedMs < 23_000)
  const cameraFocus = comparisonOverview ? overviewFocus : focus
  const cameraShot = useMemo<CameraShot>(() => {
    if (!comparisonOverview || evidenceVehicles.length < 2) return cue.camera
    const xs = evidenceVehicles.map((vehicle) => vehicle.x)
    const span = (Math.max(...xs) - Math.min(...xs)) * SCENE_SCALE
    return {
      offset: [0, Math.max(17, span * 0.38), Math.max(23, span * 0.52)],
      fov: 48,
      lookAhead: 0,
    }
  }, [comparisonOverview, cue.camera, evidenceVehicles])
  const sourceVehicle = evidenceVehicles.find((vehicle) => vehicle.id === accidentVehicleId)
  const showEvent = stage !== 'normal' && stage !== 'summary' && events.length > 0
  const showShockwave = stage === 'accident' && cue.stageProgress < 0.42

  return (
    <div className={`presentation-scene ${freezeEvidenceFrame ? 'presentation-scene--evidence' : ''}`}
      data-testid="scene-3d" aria-label="三维高速公路通信演示">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={{ position: [focus.x - 4.8, 4.8, focus.z + 6.9], fov: 40, near: 0.05, far: 650 }}
        gl={{ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = 0.94
          gl.setClearColor(new Color('#aebdc4'))
        }}
      >
        <fog attach="fog" args={['#aebcc2', 62, 218]} />
        <Sky distance={430} sunPosition={[-58, 34, -30]} inclination={0.5} azimuth={0.16}
          turbidity={5.2} rayleigh={1.45} mieCoefficient={0.0055} mieDirectionalG={0.79} />
        <UrbanDaylight focus={cameraFocus} />
        <FollowCameraRig focus={cameraFocus} shot={cameraShot}
          followVehicleId={comparisonOverview ? null
            : (cameraFollow === 'selected' ? selectedVehicleId : accidentVehicleId)
              ?? accidentVehicleId ?? selectedVehicleId ?? null}
          animationChannel={animationChannel} fixedVehicles={fixedVehicles}
          resetToken={cameraResetToken} onStatus={setCameraStatus} />
        <Suspense fallback={null}>
          <Road3D layout="highway" />
          <VehicleFleet3D vehicles={vehicles} animationChannel={animationChannel}
            fixedVehicles={fixedVehicles}
            selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
            relevantIds={candidateIds} notifiedIds={notifiedIds}
            stage={stage} elapsedMs={elapsedMs}
            interactive={interactive} onVehicleSelect={onVehicleSelect} />
          <IncidentAnalysis3D focus={focus} progress={cue.riskProgress} />
          {stage === 'ai' && corridorRadiusM && sourceVehicle && <RiskCorridor3D
            focus={focus} sourceY={sourceVehicle.y} radiusM={corridorRadiusM}
            laneScope={corridorLaneScope} />}
          <ShockwaveEffect3D events={showEvent ? events : []} animationChannel={animationChannel}
            active={showShockwave} layout="highway" />
          <Message3D messages={evidenceError ? [] : messages} vehicles={vehicles}
            animationChannel={animationChannel}
            fixedVehicles={fixedVehicles}
            tone={messageTone} layout="highway" revealProgress={cue.linkRevealProgress}
            priorityByVehicle={priorityByVehicle} />
        </Suspense>
      </Canvas>
      {evidenceError && <div className="scene-evidence-error" role="alert">
        证据时间不同步：通信端点缺少对应车辆，已停止绘制异常连线。
      </div>}
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
