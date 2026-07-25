import { useCallback, useEffect, useRef, useState } from 'react'

import {
  NarrativeStage,
  useNarrativeTimeline,
} from '../components/DemoMode/NarrativeStages'
import type { CameraCommand } from '../engine/CameraController'
import { useAnimationRuntime } from '../runtime/AnimationRuntimeContext'
import type { DemoScenario } from '../types/demo'
import type {
  ComparisonPair,
  ControlAction,
  StateUpdateMessage,
} from '../types/simulation'
import type { WebSocketStatus } from './useWebSocket'

type DemoPresentationOptions = {
  enabled: boolean
  scenarios: DemoScenario[]
  activeIndex: number
  loop: boolean
  activeState: StateUpdateMessage | null
  comparisonPair: ComparisonPair | null
  completed: boolean
  status: WebSocketStatus
  simulationPath: string | null
  setVisualization: (mode: '2d' | '3d') => void
  sendControl: (action: ControlAction, speed?: number) => boolean
  startScenario: (scenario?: DemoScenario) => void
  advanceScenario: (index: number, scenario: DemoScenario) => void
}

export function useDemoPresentation({
  enabled,
  scenarios,
  activeIndex,
  loop,
  activeState,
  comparisonPair,
  completed,
  status,
  simulationPath,
  setVisualization,
  sendControl,
  startScenario,
  advanceScenario,
}: DemoPresentationOptions) {
  const { animation, camera } = useAnimationRuntime()
  const [playing, setPlaying] = useState(false)
  const [evidence, setEvidence] = useState<StateUpdateMessage | null>(null)
  const [autoCamera, setAutoCamera] = useState(true)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const narrative = useNarrativeTimeline(enabled, playing)
  const previousStage = useRef<NarrativeStage | null>(null)
  const seenLiveEvents = useRef(new Set<string>())
  const evidenceRef = useRef<StateUpdateMessage | null>(null)
  const baselineEvidenceRef = useRef<StateUpdateMessage | null>(null)
  const slowMotionTimer = useRef<number | null>(null)
  const resetTimeline = narrative.reset

  const triggerSlowMotion = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (slowMotionTimer.current !== null) window.clearTimeout(slowMotionTimer.current)
    animation.setTimeScale(0.3)
    slowMotionTimer.current = window.setTimeout(() => {
      slowMotionTimer.current = null
      animation.setTimeScale(1, 500)
    }, 2000)
  }, [animation])

  useEffect(() => () => {
    if (slowMotionTimer.current !== null) window.clearTimeout(slowMotionTimer.current)
    animation.setTimeScale(1)
  }, [animation])

  const clearEvidence = useCallback(() => {
    setEvidence(null)
    evidenceRef.current = null
    baselineEvidenceRef.current = null
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    clearEvidence()
    resetTimeline()
    previousStage.current = null
    if (slowMotionTimer.current !== null) window.clearTimeout(slowMotionTimer.current)
    slowMotionTimer.current = null
    animation.setTimeScale(1)
    camera.reset()
  }, [animation, camera, clearEvidence, resetTimeline])

  useEffect(() => camera.subscribe((command) => {
    setCameraCommand(command)
    setVisualization(command.visualization)
  }), [camera, setVisualization])

  useEffect(() => camera.setEnabled(autoCamera), [autoCamera, camera])

  useEffect(() => {
    if (!enabled) camera.observe(activeState, completed)
  }, [activeState, camera, completed, enabled])

  useEffect(() => {
    if (enabled || !activeState?.events.length) return
    const unseen = activeState.events.some((event) => {
      const key = `${event.id}:${event.timestamp}`
      if (seenLiveEvents.current.has(key)) return false
      seenLiveEvents.current.add(key)
      return true
    })
    if (unseen) triggerSlowMotion()
  }, [activeState, enabled, triggerSlowMotion])

  useEffect(() => {
    if (activeState && (activeState.events.length > 0 || activeState.messages.length > 0
      || (activeState.decision.candidate_vehicles?.length ?? 0) > 0)) {
      setEvidence(activeState)
      evidenceRef.current = activeState
    }
    if (comparisonPair?.baseline.messages.length) {
      baselineEvidenceRef.current = comparisonPair.baseline
    }
  }, [activeState, comparisonPair])

  useEffect(() => {
    if (!enabled || previousStage.current === narrative.stage.stage) return
    previousStage.current = narrative.stage.stage
    const event = scenarios[activeIndex]?.events?.[0]
    if (narrative.stage.stage === NarrativeStage.EVENT_TRIGGERED) {
      if (event) camera.focusEvent(event)
      triggerSlowMotion()
    }
    if (narrative.stage.stage === NarrativeStage.SUCCESS) camera.showGlobal()
    if (narrative.stage.stage === NarrativeStage.MESSAGES_FLYING
      || narrative.stage.stage === NarrativeStage.COMPARISON) {
      const replay = () => {
        const ai = evidenceRef.current
        const baseline = baselineEvidenceRef.current
        if (ai?.messages.length) animation.replayMessages('comparison-ai', ai.messages)
        if (baseline?.messages.length) {
          animation.replayMessages('comparison-baseline', baseline.messages)
        }
      }
      replay()
      const interval = window.setInterval(replay, 1900)
      return () => window.clearInterval(interval)
    }
  }, [activeIndex, animation, camera, enabled, narrative.stage.stage, scenarios,
    triggerSlowMotion])

  useEffect(() => {
    if (!narrative.complete) return
    setPlaying(false)
    camera.reset()
  }, [camera, narrative.complete])

  useEffect(() => {
    if (!enabled || !narrative.complete || !loop) return
    const available = scenarios
      .map((scenario, index) => ({ scenario, index }))
      .filter((item) => item.scenario.available)
    const currentPosition = available.findIndex((item) => item.index === activeIndex)
    const next = available[(currentPosition + 1) % available.length]
    if (!next || (next.index === activeIndex && available.length === 1)) return
    const timer = window.setTimeout(() => {
      resetTimeline()
      clearEvidence()
      setPlaying(true)
      advanceScenario(next.index, next.scenario)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [activeIndex, advanceScenario, clearEvidence, enabled, loop, narrative.complete,
    resetTimeline, scenarios])

  const togglePlayback = useCallback(() => {
    if (playing) {
      if (status === 'connected' && !completed) sendControl('pause')
      animation.setPaused(true)
      setPlaying(false)
      return
    }
    if (!simulationPath || narrative.complete) {
      resetTimeline()
      clearEvidence()
      camera.reset()
      startScenario()
    } else if (status === 'connected' && !completed) {
      sendControl('play')
    }
    animation.setPaused(false)
    setPlaying(true)
  }, [animation, camera, clearEvidence, completed, narrative.complete, playing, resetTimeline,
    sendControl, simulationPath, startScenario, status])

  const userOverrideCamera = useCallback(() => camera.userOverride(), [camera])

  const stageIndex = Object.values(NarrativeStage).indexOf(narrative.stage.stage)
  const previewEvent = scenarios[activeIndex]?.events?.[0]
  const events = enabled && stageIndex >= 2
    ? (activeState?.events.length ? activeState.events : previewEvent ? [previewEvent] : [])
    : activeState?.events ?? []
  const state = activeState && evidence
    ? { ...activeState, events, messages: evidence.messages, decision: evidence.decision }
    : activeState
  const effectMode = narrative.stage.stage === NarrativeStage.EVENT_TRIGGERED
    ? 'event' as const
    : narrative.stage.stage === NarrativeStage.AI_SCANNING ? 'scan' as const : 'idle' as const
  const comparisonStage = enabled && narrative.stage.stage === NarrativeStage.COMPARISON

  return {
    playing,
    narrative,
    autoCamera,
    setAutoCamera,
    cameraCommand,
    evidence,
    state,
    events,
    effectMode,
    comparisonStage,
    overlayComparison: comparisonStage && narrative.elapsedMs < 52_000,
    togglePlayback,
    reset,
    clearEvidence,
    userOverrideCamera,
  }
}
