import type { LatLngTuple } from 'leaflet'

const LATERAL_DISPLAY_SCALE = 20

export function toMapPosition(x: number, y: number): LatLngTuple {
  return [y * LATERAL_DISPLAY_SCALE, x]
}
