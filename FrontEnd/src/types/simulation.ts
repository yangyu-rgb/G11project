export type VehicleStatus = 'normal' | 'sending' | 'receiving'

export type SimulationVehicle = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  heading: number
  status: VehicleStatus
}

export type SimulationEvent = {
  id: string
  type: string
  x: number
  y: number
  timestamp: number
  severity: number
  source_vehicle_id?: string | null
  pre_brake_speed_kmh?: number | null
  post_brake_speed_kmh?: number | null
}

export type SimulationTransmission = {
  from: string
  to: string
  status: 'success' | 'timeout'
  delay_ms: number
}

export type SimulationMetrics = {
  avg_delay_ms: number
  delivery_rate: number
  comm_overhead: number
}

export type AttentionWeight = {
  vehicle_id: string
  event_id: string
  weight: number
}

export type ComparisonBaseline = 'broadcast' | 'distance' | 'urgency'
export type SimulationMethod = 'ai' | ComparisonBaseline

export type CandidateVehicle = {
  id: string
  distance_m: number
  status: VehicleStatus | 'selected' | string
  longitudinal_m?: number
  lateral_m?: number
  lane_relation?: 'same' | 'adjacent' | 'other' | string
  risk_class?: 'following_lane' | 'adjacent_lane' | 'ahead' | 'opposite_direction' | 'unrelated' | string
}

export type ReceiverRelation = {
  id: string
  distance_m: number
  longitudinal_m: number
  lateral_m: number
  lane_relation: 'same' | 'adjacent' | 'other' | string
  risk_class: 'following_lane' | 'adjacent_lane' | 'ahead' | 'opposite_direction' | 'unrelated' | string
  selected: boolean
  outcome: 'selected' | 'ahead' | 'opposite_direction' | 'outside_lane_scope' | 'outside_corridor'
  corridor_limit_m: number
}

export type SimulationDecision = {
  selected_receivers: string[]
  priority: 'low' | 'medium' | 'high'
  bandwidth_allocation: number[]
  candidate_vehicles?: CandidateVehicle[]
  selected_vehicles?: string[]
  selection_reason?: Record<string, string>
  inference_time_ms?: number
  action_mode?: 'directional_corridor' | 'individual' | string
  corridor_radius_m?: number
  corridor_lane_scope?: 'same' | 'same_and_adjacent' | string
  structured_action?: [number, number, number, number]
  bandwidth_fraction?: number
  receiver_relations?: ReceiverRelation[]
}

export type TestMessage = {
  type: 'test'
  timestamp: number
  message: string
}

export type StateUpdateMessage = {
  type: 'state_update'
  timestamp: number
  vehicles: SimulationVehicle[]
  events: SimulationEvent[]
  messages: SimulationTransmission[]
  metrics: SimulationMetrics
  decision: SimulationDecision
  attention_weights?: AttentionWeight[]
  method?: SimulationMethod
}

export type ComparisonPair = {
  ai: StateUpdateMessage
  baseline: StateUpdateMessage
}

export type MetricHistoryPoint = SimulationMetrics & { timestamp: number }

export type ControlAction = 'play' | 'pause' | 'reset' | 'set_speed'

export type ControlAckMessage = {
  type: 'control_ack'
  action: ControlAction
  playing: boolean
  speed: number
}

export type SimulationErrorMessage = {
  type: 'error'
  code: string
  message: string
}

export type SimulationCompleteMessage = {
  type: 'simulation_complete'
  timestamp: number
}

export type SimulationMessage =
  | TestMessage
  | StateUpdateMessage
  | ControlAckMessage
  | SimulationErrorMessage
  | SimulationCompleteMessage

export const EMPTY_METRICS: SimulationMetrics = {
  avg_delay_ms: 0,
  delivery_rate: 0,
  comm_overhead: 0,
}
