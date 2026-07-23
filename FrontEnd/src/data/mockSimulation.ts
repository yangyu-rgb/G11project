import type {
  MapEvent,
  MapMessage,
  MapVehicle,
  RealtimeMetricValues,
} from '../types/simulation'

export const mockVehicles: MapVehicle[] = [
  { id: 'vehicle_0', x: 1000, y: 0, speedKmh: 102, status: 'sending' },
  { id: 'vehicle_1', x: 1500, y: 0, speedKmh: 96, status: 'receiving' },
  { id: 'vehicle_2', x: 1250, y: 4, speedKmh: 88, status: 'receiving' },
  { id: 'vehicle_3', x: 1800, y: 8, speedKmh: 110, status: 'receiving' },
  { id: 'vehicle_4', x: 2400, y: 4, speedKmh: 105, status: 'normal' },
]

export const mockEvents: MapEvent[] = [
  { id: 'event_0', type: 'emergency_braking', x: 950, y: 0, timestamp: 14.8 },
]

export const mockMessages: MapMessage[] = [
  { id: 'message_0_1', senderId: 'vehicle_0', receiverId: 'vehicle_1', status: 'success' },
  { id: 'message_0_2', senderId: 'vehicle_0', receiverId: 'vehicle_2', status: 'success' },
  { id: 'message_0_3', senderId: 'vehicle_0', receiverId: 'vehicle_3', status: 'timeout' },
]

export const mockMetrics: RealtimeMetricValues = {
  latencyMs: 25,
  coveragePercent: 80,
  communicationOverhead: 1.5,
}
