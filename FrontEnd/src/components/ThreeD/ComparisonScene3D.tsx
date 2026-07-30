import { PerformanceMonitor, PerspectiveCamera, View } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { ACESFilmicToneMapping, SRGBColorSpace, VSMShadowMap } from 'three'

import type { ComparisonBaseline, ComparisonPair } from '../../types/simulation'
import type { PresentationStage } from '../Presentation/presentationTimeline'
import { baselineDefinition } from '../Presentation/presentationMethods'
import {
  CameraControlBar,
  SceneLayerToolbar,
  SceneRendererSettings,
  SceneWorld3D,
  type CameraFollow,
  type CameraStatus,
  type CameraSyncState,
  type RenderQuality,
} from './Scene3D'
import {
  DEFAULT_PRESENTATION_ATMOSPHERE,
  DEFAULT_PRESENTATION_ENVIRONMENT,
  DEFAULT_RENDER_PREFERENCE,
  DEFAULT_SCENE_LAYERS,
  type PresentationAtmosphere,
  type PresentationEnvironment,
  type RenderPreference,
  type SceneLayerState,
} from './environmentPresets'

type ComparisonScene3DProps = {
  pair: ComparisonPair
  accidentVehicleId: string
  selectedVehicleId: string | null
  priorityByVehicle?: Readonly<Record<string, number>>
  elapsedMs: number
  stage: PresentationStage
  baseline: ComparisonBaseline
  onVehicleSelect: (vehicleId: string) => void
  environmentPreset?: PresentationEnvironment
  atmosphere?: PresentationAtmosphere
  renderPreference?: RenderPreference
  layers?: SceneLayerState
}

export function ComparisonScene3D({ pair, accidentVehicleId, selectedVehicleId,
  priorityByVehicle = {}, elapsedMs, stage, baseline, onVehicleSelect,
  environmentPreset = DEFAULT_PRESENTATION_ENVIRONMENT,
  atmosphere = DEFAULT_PRESENTATION_ATMOSPHERE,
  renderPreference = DEFAULT_RENDER_PREFERENCE,
  layers = DEFAULT_SCENE_LAYERS }: ComparisonScene3DProps) {
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ mode: 'directed' })
  const [cameraFollow, setCameraFollow] = useState<CameraFollow>('accident')
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(
    renderPreference === 'presentation' ? 'high' : 'reduced',
  )
  const [activeLayers, setActiveLayers] = useState(layers)
  useEffect(() => {
    if (renderPreference === 'presentation') setRenderQuality('high')
    else if (renderPreference === 'balanced') setRenderQuality('reduced')
  }, [renderPreference])
  const syncState = useRef<CameraSyncState>({
    owner: 'baseline', position: [-4.8, 4.8, 6.9], target: [0, 0, 0], fov: 42,
  })
  const aiCandidates = pair.ai.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? []
  const baselineCandidates = pair.baseline.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? []
  const baselineMethod = baselineDefinition(baseline)
  const frozen = stage === 'comparison' || stage === 'summary'
  const handleFollow = (follow: CameraFollow) => {
    setCameraFollow(follow)
    setCameraResetToken((value) => value + 1)
  }
  return <div className="comparison-scene" data-testid="comparison-scene" data-stage={stage}
    data-environment={environmentPreset}
    data-atmosphere={atmosphere}
    aria-label={`Synchronized 3D comparison of ${baselineMethod.label} and AI selective broadcast`}>
    <div className="comparison-scene__views">
      <View className="comparison-viewport" index={1}>
        <PerspectiveCamera makeDefault position={[-4.8, 4.8, 6.9]} fov={42} near={0.05} far={650} />
        <SceneWorld3D vehicles={pair.baseline.vehicles} events={pair.baseline.events}
          messages={pair.baseline.messages} animationChannel="comparison-baseline"
          messageTone="baseline" candidateIds={baselineCandidates}
          notifiedIds={pair.baseline.decision.selected_receivers}
          selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
          stage={stage} elapsedMs={elapsedMs} freezeEvidenceFrame={frozen} interactive
          strategyRole="baseline" environmentPreset={environmentPreset} atmosphere={atmosphere}
          bandwidthFraction={pair.baseline.decision.bandwidth_fraction}
          layers={activeLayers} renderQuality={renderQuality}
          onVehicleSelect={onVehicleSelect} cameraResetToken={cameraResetToken}
          cameraFollow={cameraFollow} onCameraStatus={setCameraStatus}
          syncId="baseline" syncState={syncState} />
      </View>
      <View className="comparison-viewport" index={2}>
        <PerspectiveCamera makeDefault position={[-4.8, 4.8, 6.9]} fov={42} near={0.05} far={650} />
        <SceneWorld3D vehicles={pair.ai.vehicles} events={pair.ai.events}
          messages={pair.ai.messages} animationChannel="comparison-ai" messageTone="ai"
          candidateIds={aiCandidates} notifiedIds={pair.ai.decision.selected_receivers}
          selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
          stage={stage} elapsedMs={elapsedMs} freezeEvidenceFrame={frozen} interactive
          strategyRole="ai"
          corridorRadiusM={pair.ai.decision.corridor_radius_m}
          corridorLaneScope={pair.ai.decision.corridor_lane_scope}
          priorityByVehicle={priorityByVehicle} onVehicleSelect={onVehicleSelect}
          environmentPreset={environmentPreset} atmosphere={atmosphere}
          bandwidthFraction={pair.ai.decision.bandwidth_fraction}
          layers={activeLayers} renderQuality={renderQuality}
          cameraResetToken={cameraResetToken} cameraFollow={cameraFollow}
          onCameraStatus={setCameraStatus} syncId="ai" syncState={syncState} />
      </View>
    </div>
    <Canvas className="comparison-scene__canvas" shadows="variance"
      dpr={renderQuality === 'high' ? [1.15, 1.35] : [1, 1.15]}
      gl={{ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace
        gl.toneMapping = ACESFilmicToneMapping
        gl.shadowMap.type = VSMShadowMap
      }}>
      <PerformanceMonitor bounds={(refreshRate) => [Math.min(35, refreshRate * 0.58), Math.min(52, refreshRate * 0.86)]}
        flipflops={3} onDecline={() => { if (renderPreference === 'auto') setRenderQuality('reduced') }}
        onIncline={() => { if (renderPreference === 'auto') setRenderQuality('high') }}
        onFallback={() => { if (renderPreference === 'auto') setRenderQuality('reduced') }}>
        <SceneRendererSettings environmentPreset={environmentPreset} atmosphere={atmosphere} />
        <View.Port />
      </PerformanceMonitor>
    </Canvas>
    <div className="comparison-scene__label comparison-scene__label--baseline">
      <small>SELECTED BASELINE</small><strong>{baselineMethod.label}</strong>
      <span>{new Set(pair.baseline.decision.selected_receivers).size} receivers</span>
    </div>
    <div className="comparison-scene__label comparison-scene__label--ai">
      <small>LEARNED POLICY</small><strong>Transformer + PPO</strong>
      <span>{new Set(pair.ai.decision.selected_receivers).size} receivers</span>
    </div>
    <div className="comparison-scene__sync"><i />Same incident · Same vehicle state · Synchronized cameras</div>
    {stage !== 'summary' && <CameraControlBar status={cameraStatus} follow={cameraFollow}
      selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
      synchronized onFollow={handleFollow} />}
    {stage === 'comparison' && <SceneLayerToolbar layers={activeLayers}
      onChange={setActiveLayers} quality={renderQuality} />}
  </div>
}
