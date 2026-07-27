import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildFallbackComparison } from '../components/Presentation/presentationFallback'
import {
  findIncidentPair,
  PRESENTATION_DURATION_MS,
  stageAt,
  type PresentationStage,
} from '../components/Presentation/presentationTimeline'
import { withEmergencyIncident } from '../components/SceneEditor/PresetScenes'
import type { EditorScenario, EditorScenarioResponse } from '../components/SceneEditor/sceneTypes'
import { useAnimationRuntime } from '../runtime/AnimationRuntimeContext'
import type { ComparisonPair } from '../types/simulation'
import { DEFAULT_MODEL, useSimulationSession } from './useSimulationSession'

export type PresentationPhase = 'selecting' | 'preparing' | 'playing' | 'paused' | 'complete'
export type PresentationSource = 'real' | 'rule' | null

const PREPARATION_TIMEOUT_MS = 30_000

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
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<EditorScenario>(template)
  const [pairs, setPairs] = useState<ComparisonPair[]>([])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const loadPlayback = useCallback((history: ComparisonPair[], nextSource: Exclude<PresentationSource, null>) => {
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
    animation.setReplayElapsed(0)
    animation.setPaused(false)
    setPairs(history)
    setSource(nextSource)
    setElapsedMs(0)
    setPhase('playing')
  }, [animation])

  const startRuleFallback = useCallback((reason: string) => {
    if (!selectedVehicleId) return
    stopSession()
    const fallbackScenario = withEmergencyIncident(template, selectedVehicleId)
    setScenario(fallbackScenario)
    setNotice(`${reason}，已切换为规则演示；该结果不是PPO输出。`)
    loadPlayback(buildFallbackComparison(fallbackScenario, selectedVehicleId), 'rule')
  }, [loadPlayback, selectedVehicleId, stopSession, template])

  const start = useCallback(async () => {
    if (!selectedVehicleId || phase !== 'selecting') return
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
        model: DEFAULT_MODEL,
        speed: 5,
        mode: 'comparison',
        baseline: 'broadcast',
      })
    } catch (error) {
      startRuleFallback(error instanceof Error ? error.message : '真实模型不可用')
    }
  }, [phase, selectedVehicleId, startRuleFallback, startSession, template])

  useEffect(() => {
    if (phase !== 'preparing') return
    const timeout = window.setTimeout(() => startRuleFallback('真实模型准备超过30秒'), PREPARATION_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [phase, startRuleFallback])

  useEffect(() => {
    if (phase !== 'preparing' || !errorMessage) return
    startRuleFallback(errorMessage)
  }, [errorMessage, phase, startRuleFallback])

  useEffect(() => {
    if (phase !== 'preparing' || !completed || comparisonHistory.length === 0) return
    loadPlayback(comparisonHistory, 'real')
    setNotice('真实PPO与全量广播结果已同步，演示自动开始。')
  }, [comparisonHistory, completed, loadPlayback, phase])

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
    }
  }, [animation, phase])

  const replay = useCallback(() => {
    if (pairs.length === 0 || !source) return
    loadPlayback(pairs, source)
  }, [loadPlayback, pairs, source])

  const reset = useCallback(() => {
    stopSession()
    animation.clear()
    setScenario(template)
    setPairs([])
    setSource(null)
    setElapsedMs(0)
    setPhase('selecting')
    setNotice(null)
  }, [animation, stopSession, template])

  const evidence = useMemo(() => findIncidentPair(pairs), [pairs])
  const stage: PresentationStage = stageAt(elapsedMs)

  return {
    phase,
    source,
    selectedVehicleId,
    setSelectedVehicleId,
    scenario,
    pairs,
    evidence,
    elapsedMs,
    stage,
    notice,
    start,
    togglePause,
    replay,
    reset,
    connectionStatus,
  }
}
