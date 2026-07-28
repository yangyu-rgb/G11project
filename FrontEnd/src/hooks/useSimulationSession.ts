import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ComparisonBaseline,
  ControlAction,
  MetricHistoryPoint,
} from '../types/simulation'
import { useWebSocket } from './useWebSocket'

export type DisplayMode = 'single' | 'comparison'

export type SimulationRunConfig = {
  scenario?: string
  experimentRef?: string
  model?: string
  speed?: number
  mode?: DisplayMode
  baseline?: ComparisonBaseline
}

export const DEFAULT_SCENARIO = 'experiments/test_scenario'
export const DEFAULT_MODEL = 'experiments/highway_corridor/champion/model_best.zip'

type EndpointConfig = SimulationRunConfig & Required<Pick<SimulationRunConfig,
  'model' | 'speed' | 'mode' | 'baseline'>>

export function buildSimulationEndpoint(config: EndpointConfig, runId: number): string {
  const query = new URLSearchParams({
    model: config.model,
    speed: String(config.speed),
    run_id: String(runId),
  })
  if (config.experimentRef) query.set('experiment_ref', config.experimentRef)
  else query.set('scenario', config.scenario ?? DEFAULT_SCENARIO)
  return config.mode === 'comparison'
    ? `/ws/simulation/compare?${query.toString()}&baseline=${config.baseline}`
    : `/ws/simulation/run?${query.toString()}`
}

export function useSimulationSession() {
  const runId = useRef(0)
  const [simulationPath, setSimulationPath] = useState<string | null>(null)
  const [requestedSpeed, setRequestedSpeed] = useState(1)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('single')
  const [baseline, setBaseline] = useState<ComparisonBaseline>('distance')
  const [metricHistory, setMetricHistory] = useState<MetricHistoryPoint[]>([])
  const socket = useWebSocket(simulationPath, false)
  const clearSocketState = socket.clearState
  const sendSocketControl = socket.sendControl
  const activeState = displayMode === 'comparison' ? socket.comparisonPair?.ai ?? null : socket.stateUpdate

  useEffect(() => {
    if (!activeState) return
    setMetricHistory((history) => {
      const point = { timestamp: activeState.timestamp, ...activeState.metrics }
      const withoutDuplicate = history.filter((item) => item.timestamp !== point.timestamp)
      return [...withoutDuplicate, point].slice(-30)
    })
  }, [activeState])

  const stop = useCallback(() => {
    setSimulationPath(null)
    setMetricHistory([])
    clearSocketState()
  }, [clearSocketState])

  const start = useCallback((config: SimulationRunConfig = {}) => {
    const resolved: EndpointConfig = {
      scenario: config.scenario ?? DEFAULT_SCENARIO,
      experimentRef: config.experimentRef,
      model: config.model ?? DEFAULT_MODEL,
      speed: config.speed ?? requestedSpeed,
      mode: config.mode ?? displayMode,
      baseline: config.baseline ?? baseline,
    }
    runId.current += 1
    clearSocketState()
    setMetricHistory([])
    setDisplayMode(resolved.mode)
    setBaseline(resolved.baseline)
    setSimulationPath(buildSimulationEndpoint(resolved, runId.current))
  }, [baseline, clearSocketState, displayMode, requestedSpeed])

  const control = useCallback((action: ControlAction, speed?: number) => {
    if (action === 'set_speed' && speed !== undefined) setRequestedSpeed(speed)
    if (action === 'reset') setMetricHistory([])
    return sendSocketControl(action, speed)
  }, [sendSocketControl])

  const changeMode = useCallback((mode: DisplayMode) => {
    if (mode === displayMode) return
    setDisplayMode(mode)
    stop()
  }, [displayMode, stop])

  const changeBaseline = useCallback((nextBaseline: ComparisonBaseline) => {
    if (nextBaseline === baseline) return
    setBaseline(nextBaseline)
    stop()
  }, [baseline, stop])

  return {
    ...socket,
    activeState,
    simulationPath,
    requestedSpeed,
    displayMode,
    baseline,
    metricHistory,
    currentSpeed: socket.controlState?.speed ?? requestedSpeed,
    playing: socket.controlState?.playing
      ?? (socket.status === 'connected' && !socket.completed),
    start,
    stop,
    control,
    changeMode,
    changeBaseline,
  }
}
