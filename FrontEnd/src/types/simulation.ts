export type VehicleStatus = 'normal' | 'sending' | 'receiving'

export type MapVehicle = {
  id: string
  x: number
  y: number
  speedKmh: number
  status: VehicleStatus
}

export type MapEvent = {
  id: string
  type: 'emergency_braking'
  x: number
  y: number
  timestamp: number
}

export type MapMessage = {
  id: string
  senderId: string
  receiverId: string
  status: 'success' | 'timeout'
}

export type RealtimeMetricValues = {
  latencyMs: number
  coveragePercent: number
  communicationOverhead: number
}
