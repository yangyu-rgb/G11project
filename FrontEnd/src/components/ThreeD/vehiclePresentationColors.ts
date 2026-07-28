import type { SimulationVehicle } from '../../types/simulation'

export const PRESENTATION_VEHICLE_COLORS = {
  accident: '#ef4444',
  notified: '#2dd4a3',
  candidate: '#f0a84b',
  selected: '#e8f4ff',
  unrelated: '#75818d',
} as const

export function presentationVehicleColor(
  vehicle: SimulationVehicle & { motion?: string },
  selectedVehicleId: string | null | undefined,
  accidentVehicleId: string | null | undefined,
  relevant: ReadonlySet<string>,
  notified: ReadonlySet<string>,
): string {
  if (vehicle.id === accidentVehicleId) {
    return PRESENTATION_VEHICLE_COLORS.accident
  }
  if (notified.has(vehicle.id)) return PRESENTATION_VEHICLE_COLORS.notified
  if (relevant.has(vehicle.id)) return PRESENTATION_VEHICLE_COLORS.candidate
  if (vehicle.id === selectedVehicleId) return PRESENTATION_VEHICLE_COLORS.selected
  return PRESENTATION_VEHICLE_COLORS.unrelated
}
