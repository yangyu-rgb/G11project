import type { LatLngTuple } from 'leaflet'

export type BaseMapStyle = 'street' | 'satellite'

export const MAP_ORIGIN: LatLngTuple = [22.3193, 114.1694]
export const MAP_AXIS_BEARING_DEGREES = 90
export const METERS_PER_LATITUDE_DEGREE = 111_320

export const BASE_MAPS: Record<BaseMapStyle, {
  label: string
  url: string
  attribution: string
  maxZoom: number
}> = {
  street: {
    label: '街道图',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    label: '卫星图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri and imagery providers',
    maxZoom: 19,
  },
}

export const MAP_DETAIL_ZOOM_THRESHOLD = 14
export const MAP_NOTICE = '仿真坐标投影 · 非真实道路采集数据'
