import type { EditorScenario } from '../components/SceneEditor/sceneTypes'
import type { ComparisonPair, StateUpdateMessage } from './simulation'

export type NetworkOverrides = {
  critical_radius_m: number
  total_bandwidth_mbps: number
  base_delay_ms: number
  jitter_max_ms: number
  far_packet_loss_rate: number
  network_mode: 'simple' | '3gpp'
  safety_window_ms: number
}

export type ExperimentPreview = {
  experiment_ref: string
  scenario_ref: string
  normalized_network: NetworkOverrides
  seed: number
  baseline: string
  warnings: string[]
  comparability: 'comparable'
  expires_at: number
}

export type ExperimentPreset = {
  id: string
  title: string
  question: string
  network: NetworkOverrides
  source: 'configuration'
  out_of_distribution: boolean
}

export type ExperimentNotebookEntry = {
  id: string
  createdAt: string
  hypothesis: string
  scenarioName: string
  vehicleId: string
  network: NetworkOverrides
  result: { aiReceivers: number; baselineReceivers: number; aiDelayMs: number; baselineDelayMs: number }
  source: 'real' | 'rule'
}

export type VehicleEvidence = {
  vehicleId: string
  candidate: boolean
  selected: boolean
  distanceM: number | null
  attention: number | null
  reason: string
  bandwidth: number | null
  delivered: boolean
  delayMs: number | null
  timestamp: number
}

export const DEFAULT_NETWORK_OVERRIDES: NetworkOverrides = {
  critical_radius_m: 300,
  total_bandwidth_mbps: 100,
  base_delay_ms: 20,
  jitter_max_ms: 10,
  far_packet_loss_rate: 0.1,
  network_mode: 'simple',
  safety_window_ms: 100,
}

export function evidenceFrameIndex(pairs: ComparisonPair[]): number {
  const eventIndex = pairs.findIndex((pair) => pair.ai.events.length > 0 || pair.baseline.events.length > 0)
  if (eventIndex >= 0) return eventIndex
  const decisionIndex = pairs.findIndex((pair) => pair.ai.decision.selected_receivers.length > 0
    || pair.baseline.decision.selected_receivers.length > 0)
  return decisionIndex >= 0 ? decisionIndex : Math.max(0, pairs.length - 1)
}

export function evidenceForVehicle(update: StateUpdateMessage, vehicleId: string): VehicleEvidence {
  const candidate = update.decision.candidate_vehicles?.find((item) => item.id === vehicleId)
  const selectedIndex = update.decision.selected_receivers.indexOf(vehicleId)
  const matchingAttention = update.attention_weights
    ?.filter((item) => item.vehicle_id === vehicleId) ?? []
  const attention = matchingAttention.length > 0
    ? matchingAttention.reduce((maximum, item) => Math.max(maximum, item.weight), 0)
    : null
  const message = update.messages.find((item) => item.to === vehicleId)
  return {
    vehicleId,
    candidate: Boolean(candidate),
    selected: selectedIndex >= 0,
    distanceM: candidate?.distance_m ?? null,
    attention,
    reason: update.decision.selection_reason?.[vehicleId] ?? (candidate ? '候选未选择' : '候选范围外'),
    bandwidth: selectedIndex >= 0 ? update.decision.bandwidth_allocation[selectedIndex] ?? null : null,
    delivered: message?.status === 'success',
    delayMs: message?.delay_ms ?? null,
    timestamp: update.timestamp,
  }
}

export function configuredScenario(scenario: EditorScenario, vehicleId: string): EditorScenario {
  const source = scenario.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? scenario.vehicles[0]
  const existing = scenario.events.find((event) => event.source_vehicle_id === source.id)
  return {
    ...scenario,
    name: `${scenario.name}-研究实验`,
    events: [existing ?? {
      id: 'event_research_braking',
      type: 'emergency_braking',
      x: source.x,
      y: source.y,
      timestamp: 2,
      severity: 0.9,
      source_vehicle_id: source.id,
      pre_brake_speed_kmh: 96,
      post_brake_speed_kmh: 18,
    }],
  }
}
