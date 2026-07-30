import { Environment, Lightformer, OrbitControls, PerformanceMonitor, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  MathUtils,
  Object3D,
  SRGBColorSpace,
  VSMShadowMap,
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
import {
  DEFAULT_PRESENTATION_ATMOSPHERE,
  DEFAULT_PRESENTATION_ENVIRONMENT,
  DEFAULT_RENDER_PREFERENCE,
  DEFAULT_SCENE_LAYERS,
  presentationEnvironmentVisuals,
  type PresentationAtmosphere,
  type PresentationEnvironment,
  type RenderPreference,
  type SceneLayerState,
} from './environmentPresets'
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
  clampCameraTarget,
  endManualCamera,
  requestDirectedCamera,
  settleDirectedCamera,
  type CameraControlMode,
  type CameraControlState,
} from './cameraControl'

export type Scene3DProps = {
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
  bandwidthFraction?: number
  interactive?: boolean
  onVehicleSelect?: (vehicleId: string) => void
  showCameraControls?: boolean
  strategyRole?: 'baseline' | 'ai'
  environmentPreset?: PresentationEnvironment
  atmosphere?: PresentationAtmosphere
  renderPreference?: RenderPreference
  layers?: SceneLayerState
}

export type CameraStatus = { mode: CameraControlMode }
export type CameraFollow = 'overview' | 'accident' | 'selected'
export type RenderQuality = 'high' | 'reduced'
export type CameraSyncState = {
  owner: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export function SceneRendererSettings({ environmentPreset, atmosphere }: {
  environmentPreset: PresentationEnvironment
  atmosphere: PresentationAtmosphere
}) {
  const { gl } = useThree()
  useEffect(() => {
    const visuals = presentationEnvironmentVisuals(environmentPreset, atmosphere)
    gl.toneMappingExposure = visuals.exposure
    gl.setClearColor(new Color(visuals.background))
  }, [atmosphere, environmentPreset, gl])
  return null
}

const COMPARISON_FOLLOW_CAMERA_SHOT: CameraShot = {
  offset: [-4.6, 3, 5.6], fov: 38, lookAhead: 0.8,
}

function SceneLighting({ focus, environmentPreset, atmosphere, quality }: {
  focus: Vector3
  environmentPreset: PresentationEnvironment
  atmosphere: PresentationAtmosphere
  quality: RenderQuality
}) {
  const sunTarget = useMemo(() => new Object3D(), [])
  const visuals = presentationEnvironmentVisuals(environmentPreset, atmosphere)
  const golden = atmosphere === 'golden_hour' && environmentPreset !== 'tunnel'
  const overcast = atmosphere === 'overcast_haze' && environmentPreset !== 'tunnel'
  return (
    <>
      <primitive object={sunTarget} position={[focus.x + 1.5, 0, focus.z]} />
      {environmentPreset === 'tunnel'
        ? <Environment resolution={128} frames={1} environmentIntensity={0.56}>
          <Lightformer form="rect" color="#eaf8ff" intensity={4.2}
            position={[0, 7, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[18, 5, 1]} />
          <Lightformer form="rect" color="#8cb9cc" intensity={1.35}
            position={[8, 3, 4]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 4, 1]} />
        </Environment>
        : <Environment resolution={128} frames={1}
          environmentIntensity={environmentPreset === 'open_highway' ? 0.72 : 0.64}>
          <Lightformer form="rect" color="#e8f7ff" intensity={3.1}
            position={[-7, 9, 7]} rotation={[Math.PI / 3, 0.4, 0]} scale={[10, 8, 1]} />
          <Lightformer form="rect" color="#d5e9f1" intensity={1.35}
            position={[8, 4, -8]} rotation={[0, -Math.PI / 3, 0]} scale={[12, 5, 1]} />
          <Lightformer form="ring" color="#fff0cf" intensity={1.6}
            position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[4, 4, 1]} />
        </Environment>}
      <hemisphereLight args={visuals.hemisphere} />
      <ambientLight color={visuals.ambient[0]} intensity={visuals.ambient[1]} />
      <directionalLight castShadow color={visuals.sun[0]} target={sunTarget}
        position={[focus.x - (golden ? 30 : 18), golden ? 8 : 24, focus.z + (golden ? 22 : 14)]}
        intensity={visuals.sun[1]}
        shadow-mapSize-width={quality === 'high' ? 2048 : 1024}
        shadow-mapSize-height={quality === 'high' ? 2048 : 1024}
        shadow-camera-near={2} shadow-camera-far={65}
        shadow-camera-left={-26} shadow-camera-right={26}
        shadow-camera-top={22} shadow-camera-bottom={-22}
        shadow-bias={-0.00012} shadow-normalBias={0.035} />
      <directionalLight color={golden ? '#9fc7df' : '#b8d8e7'}
        position={[focus.x + 20, 9, focus.z - 18]} intensity={overcast ? 0.24 : 0.42} />
    </>
  )
}

function FollowCameraRig({ focus, shot, followVehicleId, animationChannel, fixedVehicles, resetToken,
  onStatus, syncId, syncState }: {
  focus: Vector3
  shot: CameraShot
  followVehicleId: string | null
  animationChannel: AnimationChannel
  fixedVehicles?: readonly SimulationVehicle[]
  resetToken: number
  onStatus: (status: CameraStatus) => void
  syncId?: string
  syncState?: MutableRefObject<CameraSyncState>
}) {
  const { camera } = useThree()
  const { animation } = useAnimationRuntime()
  const controls = useRef<OrbitControlsImpl>(null)
  const target = useRef(focus.clone())
  const desired = useRef(new Vector3())
  const correction = useRef(new Vector3())
  const returnPosition = useRef(new Vector3())
  const state = useRef<CameraControlState>({ mode: 'directed' })

  useEffect(() => {
    target.current.copy(focus)
  }, [focus])

  useEffect(() => {
    state.current = requestDirectedCamera()
    onStatus({ mode: 'returning' })
  }, [onStatus, resetToken])

  useFrame((_, delta) => {
    if (syncId && syncState && syncState.current.owner !== syncId) {
      camera.position.set(...syncState.current.position)
      if (controls.current) {
        controls.current.target.set(...syncState.current.target)
        controls.current.update()
      }
      if ('fov' in camera) {
        camera.fov = syncState.current.fov
        camera.updateProjectionMatrix()
      }
      return
    }
    const animated = followVehicleId
      ? fixedVehicles
        ? fixedVehicles.find((vehicle) => vehicle.id === followVehicleId) ?? null
        : animation.getVehicle(animationChannel, followVehicleId)
      : null
    if (animated) target.current.set(...toScenePosition(animated.x, animated.y, 'highway'))
    else target.current.copy(focus)
    if (state.current.mode === 'free') {
      if (controls.current) {
        const [x, y, z] = clampCameraTarget(controls.current.target.toArray())
        correction.current.set(x, y, z).sub(controls.current.target)
        if (correction.current.lengthSq() > 0) {
          controls.current.target.add(correction.current)
          camera.position.add(correction.current)
          controls.current.update()
        }
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
        state.current = settleDirectedCamera()
        onStatus({ mode: 'directed' })
      }
    }
    if (syncId && syncState) {
      const syncTarget = controls.current?.target ?? target.current
      syncState.current.position = camera.position.toArray()
      syncState.current.target = syncTarget.toArray()
      syncState.current.fov = 'fov' in camera ? camera.fov : syncState.current.fov
    }
  })

  const startManual = () => {
    if (syncId && syncState) syncState.current.owner = syncId
    state.current = beginManualCamera()
    onStatus({ mode: 'free' })
  }
  const endManual = () => {
    state.current = endManualCamera()
    onStatus({ mode: 'free' })
  }

  return <OrbitControls ref={controls} makeDefault
    enableRotate enableZoom enablePan screenSpacePanning minDistance={3.8} maxDistance={140}
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

type SceneWorld3DProps = Scene3DProps & {
  cameraResetToken: number
  cameraFollow: CameraFollow
  onCameraStatus: (status: CameraStatus) => void
  syncId?: string
  syncState?: MutableRefObject<CameraSyncState>
  renderQuality?: RenderQuality
}

export function SceneWorld3D({
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
  bandwidthFraction,
  interactive = false,
  onVehicleSelect,
  strategyRole = 'ai',
  environmentPreset = DEFAULT_PRESENTATION_ENVIRONMENT,
  atmosphere = DEFAULT_PRESENTATION_ATMOSPHERE,
  layers = DEFAULT_SCENE_LAYERS,
  cameraResetToken,
  cameraFollow,
  onCameraStatus,
  syncId,
  syncState,
  renderQuality = 'reduced',
}: SceneWorld3DProps) {
  const cue = useMemo(() => presentationCueAt(elapsedMs), [elapsedMs])
  const evidenceVehicles = useMemo(() => enforceHighwaySpacing(vehicles), [vehicles])
  const fixedVehicles = freezeEvidenceFrame ? evidenceVehicles : undefined
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
  const comparisonOverview = stage === 'comparison'
  const useOverview = cameraFollow === 'overview'
  const cameraFocus = useOverview ? overviewFocus : focus
  const cameraShot = useMemo<CameraShot>(() => {
    if (comparisonOverview && !useOverview) return COMPARISON_FOLLOW_CAMERA_SHOT
    if (environmentPreset === 'tunnel' && !useOverview) return {
      offset: [-3.6, 1.55, 2.85], fov: 42, lookAhead: 1.15,
    }
    if (!useOverview || evidenceVehicles.length < 2) return cue.camera
    const xs = evidenceVehicles.map((vehicle) => vehicle.x)
    const span = (Math.max(...xs) - Math.min(...xs)) * SCENE_SCALE
    return {
      offset: [0, Math.max(17, span * 0.38), Math.max(23, span * 0.52)],
      fov: 48,
      lookAhead: 0,
    }
  }, [comparisonOverview, cue.camera, environmentPreset, evidenceVehicles, useOverview])
  const cameraFollowVehicleId = cameraFollow === 'overview'
    ? null
    : cameraFollow === 'selected'
      ? selectedVehicleId ?? accidentVehicleId ?? null
      : accidentVehicleId ?? selectedVehicleId ?? null
  const sourceVehicle = evidenceVehicles.find((vehicle) => vehicle.id === accidentVehicleId)
  const showEvent = stage !== 'normal' && stage !== 'summary' && events.length > 0
  const showShockwave = stage === 'accident' && cue.stageProgress < 0.42
  const visuals = presentationEnvironmentVisuals(environmentPreset, atmosphere)
  const skySettings = atmosphere === 'golden_hour'
    ? { sunPosition: [-72, 10, -22] as [number, number, number], turbidity: 7.2, rayleigh: 1.7 }
    : atmosphere === 'overcast_haze'
      ? { sunPosition: [-42, 26, -34] as [number, number, number], turbidity: 10.5, rayleigh: 2.8 }
      : { sunPosition: [-58, 34, -30] as [number, number, number], turbidity: 5.2, rayleigh: 1.45 }

  return <>
        <color attach="background" args={[visuals.background]} />
        <fog attach="fog" args={visuals.fog} />
        {visuals.sky && <Sky distance={430} sunPosition={skySettings.sunPosition}
          inclination={0.5} azimuth={0.16} turbidity={skySettings.turbidity}
          rayleigh={skySettings.rayleigh} mieCoefficient={atmosphere === 'overcast_haze' ? 0.012 : 0.0055}
          mieDirectionalG={0.79} />
        }
        <SceneLighting focus={cameraFocus} environmentPreset={environmentPreset}
          atmosphere={atmosphere} quality={renderQuality} />
        <FollowCameraRig focus={cameraFocus} shot={cameraShot}
          followVehicleId={cameraFollowVehicleId}
          animationChannel={animationChannel} fixedVehicles={fixedVehicles}
          resetToken={cameraResetToken} onStatus={onCameraStatus}
          syncId={syncId} syncState={syncState} />
        <Suspense fallback={null}>
          <Road3D layout="highway" environmentPreset={environmentPreset}
            showInfrastructure={layers.infrastructure} />
          <VehicleFleet3D vehicles={vehicles} animationChannel={animationChannel}
            fixedVehicles={fixedVehicles}
            selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
            relevantIds={layers.vehicleState ? candidateIds : []}
            notifiedIds={layers.vehicleState ? notifiedIds : []}
            stage={stage} elapsedMs={elapsedMs} strategyRole={strategyRole}
            interactive={interactive} onVehicleSelect={onVehicleSelect} />
          <IncidentAnalysis3D focus={focus} progress={cue.riskProgress} />
          {layers.riskCorridor && stage === 'comparison' && strategyRole === 'ai' && corridorRadiusM && sourceVehicle && <RiskCorridor3D
            focus={focus} sourceY={sourceVehicle.y} radiusM={corridorRadiusM}
            laneScope={corridorLaneScope} />}
          <ShockwaveEffect3D events={showEvent ? events : []} animationChannel={animationChannel}
            active={showShockwave} layout="highway" />
          {layers.communication && <Message3D messages={messages} vehicles={vehicles}
            animationChannel={animationChannel}
            fixedVehicles={fixedVehicles}
            tone={messageTone} layout="highway" revealProgress={cue.linkRevealProgress}
            priorityByVehicle={priorityByVehicle} bandwidthFraction={bandwidthFraction} />}
        </Suspense>
      </>
}

function hasEvidenceError(vehicles: readonly SimulationVehicle[], messages: readonly SimulationTransmission[],
  freezeEvidenceFrame: boolean): boolean {
  if (!freezeEvidenceFrame) return false
  const ids = new Set(vehicles.map((vehicle) => vehicle.id))
  return messages.some((message) => !ids.has(message.from) || !ids.has(message.to))
}

export function CameraControlBar({ status, follow, selectedVehicleId, accidentVehicleId,
  synchronized = false, onFollow }: {
  status: CameraStatus
  follow: CameraFollow
  selectedVehicleId?: string | null
  accidentVehicleId?: string | null
  synchronized?: boolean
  onFollow: (follow: CameraFollow) => void
}) {
  return <div className="camera-control-status" aria-live="polite">
    <span>{synchronized ? 'Synchronized camera · ' : ''}{status.mode === 'directed' ? 'Auto follow'
      : status.mode === 'returning' ? 'Returning' : 'Free view'}</span>
    <button type="button" className={follow === 'accident' ? 'is-active' : ''}
      onClick={() => onFollow('accident')}>Incident Close-Up</button>
    {selectedVehicleId && selectedVehicleId !== accidentVehicleId && <button type="button"
      className={follow === 'selected' ? 'is-active' : ''}
      onClick={() => onFollow('selected')}>Follow Selected Vehicle</button>}
    <button type="button" className={follow === 'overview' ? 'is-active' : ''}
      onClick={() => onFollow('overview')}>Global Propagation View</button>
    <small className="camera-control-help">{synchronized ? 'Dragging either view synchronizes both · ' : ''}Left drag: rotate · Wheel: zoom · Right drag: pan</small>
  </div>
}

export function Scene3D(props: Scene3DProps) {
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ mode: 'directed' })
  const [cameraFollow, setCameraFollow] = useState<CameraFollow>(
    props.accidentVehicleId ? 'accident' : 'overview',
  )
  // Start conservatively so the first PBR frame cannot exhaust integrated-GPU memory.
  // PerformanceMonitor can promote the scene after it has observed stable frame timing.
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(
    props.renderPreference === 'presentation' ? 'high' : 'reduced',
  )
  const [activeLayers, setActiveLayers] = useState<SceneLayerState>(
    props.layers ?? DEFAULT_SCENE_LAYERS,
  )
  const renderPreference = props.renderPreference ?? DEFAULT_RENDER_PREFERENCE
  useEffect(() => {
    if (renderPreference === 'presentation') setRenderQuality('high')
    else if (renderPreference === 'balanced') setRenderQuality('reduced')
  }, [renderPreference])
  const evidenceError = hasEvidenceError(props.vehicles, props.messages, props.freezeEvidenceFrame ?? false)
  const handleFollow = (follow: CameraFollow) => {
    setCameraFollow(follow)
    setCameraResetToken((value) => value + 1)
  }
  return (
    <div className={`presentation-scene ${props.freezeEvidenceFrame ? 'presentation-scene--evidence' : ''}`}
      data-testid="scene-3d"
      data-environment={props.environmentPreset ?? DEFAULT_PRESENTATION_ENVIRONMENT}
      data-atmosphere={props.atmosphere ?? DEFAULT_PRESENTATION_ATMOSPHERE}
      aria-label="3D highway communication demonstration">
      <Canvas
        shadows="variance"
        dpr={renderQuality === 'high' ? [1.2, 1.5] : [1, 1.2]}
        camera={{ position: [-4.8, 4.8, 6.9], fov: 40, near: 0.05, far: 650 }}
        gl={{ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
          gl.toneMapping = ACESFilmicToneMapping
          gl.shadowMap.type = VSMShadowMap
        }}
      >
        <PerformanceMonitor bounds={(refreshRate) => [Math.min(42, refreshRate * 0.7), Math.min(55, refreshRate * 0.92)]}
          flipflops={3} onDecline={() => { if (renderPreference === 'auto') setRenderQuality('reduced') }}
          onIncline={() => { if (renderPreference === 'auto') setRenderQuality('high') }}
          onFallback={() => { if (renderPreference === 'auto') setRenderQuality('reduced') }}>
          <SceneWorld3D {...props} layers={activeLayers} renderQuality={renderQuality}
            messages={evidenceError ? [] : props.messages}
            cameraResetToken={cameraResetToken} cameraFollow={cameraFollow}
            onCameraStatus={setCameraStatus} />
          <SceneRendererSettings
            environmentPreset={props.environmentPreset ?? DEFAULT_PRESENTATION_ENVIRONMENT}
            atmosphere={props.atmosphere ?? DEFAULT_PRESENTATION_ATMOSPHERE} />
        </PerformanceMonitor>
      </Canvas>
      {evidenceError && <div className="scene-evidence-error" role="alert">
        Evidence is not synchronized: a communication endpoint has no matching vehicle. Invalid links were suppressed.
      </div>}
      {(props.showCameraControls ?? true) && <CameraControlBar status={cameraStatus}
        follow={cameraFollow} selectedVehicleId={props.selectedVehicleId}
        accidentVehicleId={props.accidentVehicleId} onFollow={handleFollow} />}
      {props.stage === 'comparison' && <SceneLayerToolbar layers={activeLayers}
        onChange={setActiveLayers} quality={renderQuality} />}
    </div>
  )
}

export function SceneLayerToolbar({ layers, quality, onChange }: {
  layers: SceneLayerState
  quality: RenderQuality
  onChange: (layers: SceneLayerState) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const entries: Array<[keyof SceneLayerState, string]> = [
    ['communication', 'Communication'], ['riskCorridor', 'Risk Corridor'],
    ['vehicleState', 'Vehicle State'], ['infrastructure', 'Infrastructure'],
  ]
  return <aside className={`scene-layer-toolbar ${expanded ? 'is-expanded' : 'is-collapsed'}`}
    aria-label="Visual evidence layers">
    <header><span><i />Evidence Layers</span><button type="button" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>
      {quality === 'high' ? 'Presentation' : 'Balanced'} · {expanded ? 'Hide' : 'Show'}
    </button></header>
    {expanded && <><div>{entries.map(([key, label]) => <button type="button" key={key}
      className={layers[key] ? 'is-active' : ''} aria-pressed={layers[key]}
      onClick={() => onChange({ ...layers, [key]: !layers[key] })}>{label}</button>)}</div>
    <footer><span className="legend-ai">AI path</span><span className="legend-baseline">Baseline</span>
      <span className="legend-timeout">Timeout</span><span className="legend-ack">ACK</span></footer></>}
  </aside>
}
