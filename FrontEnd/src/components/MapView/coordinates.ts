import type { LatLngTuple } from 'leaflet'

import {
  MAP_AXIS_BEARING_DEGREES,
  MAP_ORIGIN,
  METERS_PER_LATITUDE_DEGREE,
} from '../../config/mapConfig'

export function toMapPosition(x: number, y: number): LatLngTuple {
  const bearing = (MAP_AXIS_BEARING_DEGREES * Math.PI) / 180
  const perpendicular = bearing - Math.PI / 2
  const eastMeters = x * Math.sin(bearing) + y * Math.sin(perpendicular)
  const northMeters = x * Math.cos(bearing) + y * Math.cos(perpendicular)
  const latitude = MAP_ORIGIN[0] + northMeters / METERS_PER_LATITUDE_DEGREE
  const longitude = MAP_ORIGIN[1]
    + eastMeters / (METERS_PER_LATITUDE_DEGREE * Math.cos((MAP_ORIGIN[0] * Math.PI) / 180))
  return [latitude, longitude]
}

export function fromMapPosition(latitude: number, longitude: number): { x: number; y: number } {
  const bearing = (MAP_AXIS_BEARING_DEGREES * Math.PI) / 180
  const perpendicular = bearing - Math.PI / 2
  const eastMeters = (longitude - MAP_ORIGIN[1])
    * METERS_PER_LATITUDE_DEGREE
    * Math.cos((MAP_ORIGIN[0] * Math.PI) / 180)
  const northMeters = (latitude - MAP_ORIGIN[0]) * METERS_PER_LATITUDE_DEGREE
  return {
    x: eastMeters * Math.sin(bearing) + northMeters * Math.cos(bearing),
    y: eastMeters * Math.sin(perpendicular) + northMeters * Math.cos(perpendicular),
  }
}
