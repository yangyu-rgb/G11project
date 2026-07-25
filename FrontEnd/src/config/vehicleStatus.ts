import type { VehicleStatus } from '../types/simulation'

export const VEHICLE_STATUS_COLORS: Record<VehicleStatus | 'braking' | 'baseline', string> = {
  normal: '#e2e8f0',
  sending: '#3b82f6',
  receiving: '#22c55e',
  braking: '#ef4444',
  baseline: '#94a3b8',
}
