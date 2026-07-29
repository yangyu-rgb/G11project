import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  findIncidentPair,
  PRESENTATION_DURATION_MS,
  stageAt,
  type PresentationStage,
} from '../components/Presentation/presentationTimeline'
import {
  recommendedIncidentVehicleId,
  withEmergencyIncident,
} from '../components/SceneEditor/PresetScenes'
import type { EditorScenario, EditorScenarioResponse } from '../components/SceneEditor/sceneTypes'
import { useAnimationRuntime } from '../runtime/AnimationRuntimeContext'
import type { ComparisonPair } from '../types/simulation'
import { DEFAULT_MODEL, useSimulationSession } from './useSimulationSession'

export type PresentationPhase = 'selecting' | 'preparing' | 'exploring' | 'playing' | 'paused' | 'complete'
export type PresentationSource = 'real' | 'rule' | null
export type PresentationMode = 'explore' | 'autoplay'

const PREPARATION_TIMEOUT_MS = 30_000

export type PresentationModelStatus = {
  model: string
  available: boolean
  eligible: boolean
  action_mode: string | null
  reason: string | null
}

export function usePresentationDemo(template: EditorScenario) {
  const { animation } = useAnimationRuntime()
  const session = useSimulationSession()
  const {
    comparisonHistory,
    completed,
    errorMessage,
    start: startSession,
    status: connectionStatus,
    stop: stopSession,
  } = session
  const [phase, setPhase] = useState<PresentationPhase>('selecting')
  const [source, setSource] = useState<PresentationSource>(null)
  const [mode, setMode] = useState<PresentationMode>('explore')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    () => recommendedIncidentVehicleId(template) || null,
  )
  const [inspectedVehicleId, setInspectedVehicleId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<EditorScenario>(template)
  const [pairs, setPairs] = useState<ComparisonPair[]>([])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<PresentationModelStatus | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    if (phaseRef.current !== 'selecting') return
    stopSession()
    animation.clear()
    setScenario(template)
    setPairs([])
    setSource(null)
    setElapsedMs(0)
    setNotice(null)
    setInspectedVehicleId(null)
    setSelectedVehicleId(recommendedIncidentVehicleId(template) || null)
  }, [animation, stopSession, template])

  const loadPlayback = useCallback((history: ComparisonPair[], nextSource: Exclude<PresentationSource, null>, nextMode: PresentationMode = 'explore') => {
    const incident = findIncidentPair(history)
    const anchorTimestamp = incident?.ai.timestamp
    animation.clear()
    animation.loadReplay('comparison-ai', history.map((pair) => pair.ai), {
      durationMs: 30_000,
      anchorTimestamp,
      anchorAtMs: 5_000,
    })
    animation.loadReplay('comparison-baseline', history.map((pair) => pair.baseline), {
      durationMs: 30_000,
      anchorTimestamp,
      anchorAtMs: 5_000,
    })
    animation.setTimeScale(1)
    animation.setReplayElapsed(0)
    animation.setPaused(nextMode === 'explore')
    setPairs(history)
    setSource(nextSource)
    setElapsedMs(0)
    setMode(nextMode)
    setInspectedVehicleId(selectedVehicleId)
    setPhase(nextMode === 'explore' ? 'exploring' : 'playing')
  }, [animation, selectedVehicleId])

  useEffect(() => {
    let active = true
    fetch('/api/v1/demo/model-status')
      .then((response) => response.ok ? response.json() as Promise<PresentationModelStatus> : Promise.reject())
      .then((value) => { if (active) setModelStatus(value) })
      .catch(() => { if (active) setModelStatus({
        model: DEFAULT_MODEL, available: false, eligible: false, action_mode: null,
        reason: '无法读取正式模型资格状态',
      }) })
    return () => { active = false }
  }, [])

  const start = useCallback(async () => {
    if (!selectedVehicleId || phase !== 'selecting') return
    if (!modelStatus?.eligible) {
      setNotice(modelStatus?.reason ?? '正式AI模型尚未完成资格验收')
      return
    }
    const configured = withEmergencyIncident(template, selectedVehicleId)
    setScenario(configured)
    setPhase('preparing')
    setNotice(null)
    setSource(null)
    try {
      const response = await fetch('/api/v1/scenarios/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configured),
      })
      if (!response.ok) throw new Error('后端拒绝了事故场景')
      const result = await response.json() as EditorScenarioResponse
      if (!result.ai_runnable) throw new Error(result.limitations.join('；'))
      startSession({
        scenario: result.scenario_ref,
        model: modelStatus.model,
        speed: 5,
        mode: 'comparison',
        baseline: 'broadcast',
      })
    } catch (error) {
      stopSession()
      setPhase('selecting')
      setNotice(error instanceof Error ? error.message : '真实模型不可用')
    }
  }, [modelStatus, phase, selectedVehicleId, startSession, stopSession, template])

  useEffect(() => {
    if (phase !== 'preparing') return
    const timeout = window.setTimeout(() => {
      stopSession()
      setPhase('selecting')
      setNotice('真实模型准备超过30秒；演示已停止，未使用规则结果替代。')
    }, PREPARATION_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [phase, stopSession])

  useEffect(() => {
    if (phase !== 'preparing' || !errorMessage) return
    stopSession()
    setPhase('selecting')
    setNotice(`${errorMessage}；演示已停止，未使用规则结果替代。`)
  }, [errorMessage, phase, stopSession])

  useEffect(() => {
    if (phase !== 'preparing' || !completed || comparisonHistory.length === 0) return
    const invalidPair = comparisonHistory.find((pair) => pair.ai.timestamp !== pair.baseline.timestamp)
    if (invalidPair) {
      stopSession()
      setPhase('selecting')
      setNotice('AI与基线证据时间戳不同步；演示已停止，未绘制通信连线。')
      return
    }
    loadPlayback(comparisonHistory, 'real', 'explore')
    setNotice('真实PPO与全量广播结果已同步，可自由选择证据书签。')
  }, [comparisonHistory, completed, loadPlayback, phase, stopSession])

  useEffect(() => {
    if (phase !== 'playing') return
    let frame = 0
    const update = () => {
      const elapsed = animation.getReplayElapsed()
      setElapsedMs(elapsed)
      if (elapsed >= PRESENTATION_DURATION_MS) {
        animation.setPaused(true)
        setPhase('complete')
        return
      }
      frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [animation, phase])

  const togglePause = useCallback(() => {
    if (phase === 'playing') {
      animation.setPaused(true)
      setPhase('paused')
    } else if (phase === 'paused') {
      animation.setPaused(false)
      setPhase('playing')
    } else if (phase === 'exploring') {
      animation.setPaused(false)
      setPhase('playing')
    }
  }, [animation, phase])

  const replay = useCallback(() => {
    if (pairs.length === 0 || !source) return
    loadPlayback(pairs, source, mode)
  }, [loadPlayback, mode, pairs, source])

  const startAutoplay = useCallback(() => {
    if (pairs.length === 0 || !source) return
    loadPlayback(pairs, source, 'autoplay')
  }, [loadPlayback, pairs, source])

  const seek = useCallback((nextElapsedMs: number) => {
    animation.setReplayElapsed(Math.max(0, Math.min(PRESENTATION_DURATION_MS, nextElapsedMs)))
    animation.setPaused(true)
    setElapsedMs(Math.max(0, Math.min(PRESENTATION_DURATION_MS, nextElapsedMs)))
    setMode('explore')
    setPhase('exploring')
  }, [animation])

  const reset = useCallback(() => {
    stopSession()
    animation.clear()
    setScenario(template)
    setPairs([])
    setSource(null)
    setMode('explore')
    setElapsedMs(0)
    setPhase('selecting')
    setNotice(null)
    setInspectedVehicleId(null)
  }, [animation, stopSession, template])

  const evidence = useMemo(() => findIncidentPair(pairs), [pairs])
  const stage: PresentationStage = stageAt(elapsedMs)

  return {
    phase,
    source,
    mode,
    selectedVehicleId,
    setSelectedVehicleId,
    inspectedVehicleId,
    setInspectedVehicleId,
    scenario,
    pairs,
    evidence,
    elapsedMs,
    stage,
    notice,
    modelStatus,
    start,
    togglePause,
    replay,
    startAutoplay,
    seek,
    reset,
    connectionStatus,
  }
}
