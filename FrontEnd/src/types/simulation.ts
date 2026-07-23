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

export type SimulationDecision = {
  selected_receivers: string[]
  priority: 'low' | 'medium' | 'high'
  bandwidth_allocation: number[]
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
}

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
