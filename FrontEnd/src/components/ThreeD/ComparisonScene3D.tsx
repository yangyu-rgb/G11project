import { PerspectiveCamera, View } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { ACESFilmicToneMapping, Color, SRGBColorSpace } from 'three'

import type { ComparisonBaseline, ComparisonPair } from '../../types/simulation'
import type { PresentationStage } from '../Presentation/presentationTimeline'
import { baselineDefinition } from '../Presentation/presentationMethods'
import {
  CameraControlBar,
  SceneWorld3D,
  type CameraFollow,
  type CameraStatus,
  type CameraSyncState,
} from './Scene3D'
import {
  DEFAULT_PRESENTATION_ENVIRONMENT,
  presentationEnvironmentVisuals,
  type PresentationEnvironment,
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
}

export function ComparisonScene3D({ pair, accidentVehicleId, selectedVehicleId,
  priorityByVehicle = {}, elapsedMs, stage, baseline, onVehicleSelect,
  environmentPreset = DEFAULT_PRESENTATION_ENVIRONMENT }: ComparisonScene3DProps) {
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ mode: 'directed' })
  const [cameraFollow, setCameraFollow] = useState<CameraFollow>('accident')
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
  return <div className="comparison-scene" data-testid="comparison-scene"
    data-environment={environmentPreset}
    aria-label={`${baselineMethod.label}与AI选择性广播同步三维对照`}>
    <div className="comparison-scene__views">
      <View className="comparison-viewport" index={1}>
        <PerspectiveCamera makeDefault position={[-4.8, 4.8, 6.9]} fov={42} near={0.05} far={650} />
        <SceneWorld3D vehicles={pair.baseline.vehicles} events={pair.baseline.events}
          messages={pair.baseline.messages} animationChannel="comparison-baseline"
          messageTone="baseline" candidateIds={baselineCandidates}
          notifiedIds={pair.baseline.decision.selected_receivers}
          selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
          stage={stage} elapsedMs={elapsedMs} freezeEvidenceFrame={frozen} interactive
          strategyRole="baseline" environmentPreset={environmentPreset}
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
          environmentPreset={environmentPreset}
          cameraResetToken={cameraResetToken} cameraFollow={cameraFollow}
          onCameraStatus={setCameraStatus} syncId="ai" syncState={syncState} />
      </View>
    </div>
    <Canvas className="comparison-scene__canvas" shadows="percentage" dpr={[1, 1.25]}
      gl={{ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        const visuals = presentationEnvironmentVisuals(environmentPreset)
        gl.outputColorSpace = SRGBColorSpace
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = visuals.exposure
        gl.setClearColor(new Color(visuals.background))
      }}>
      <View.Port />
    </Canvas>
    <div className="comparison-scene__label comparison-scene__label--baseline">
      <small>SELECTED BASELINE</small><strong>{baselineMethod.label}</strong>
      <span>{new Set(pair.baseline.decision.selected_receivers).size} 辆接收</span>
    </div>
    <div className="comparison-scene__label comparison-scene__label--ai">
      <small>LEARNED POLICY</small><strong>Transformer + PPO</strong>
      <span>{new Set(pair.ai.decision.selected_receivers).size} 辆接收</span>
    </div>
    <div className="comparison-scene__sync"><i />同一事故 · 同一车辆状态 · 摄像机同步</div>
    {stage !== 'summary' && <CameraControlBar status={cameraStatus} follow={cameraFollow}
      selectedVehicleId={selectedVehicleId} accidentVehicleId={accidentVehicleId}
      synchronized onFollow={handleFollow} />}
  </div>
}
