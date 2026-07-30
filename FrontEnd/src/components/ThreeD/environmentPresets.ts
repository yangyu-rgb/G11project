export type PresentationEnvironment = 'open_highway' | 'city_elevated' | 'tunnel'
export type PresentationAtmosphere = 'clear_day' | 'overcast_haze' | 'golden_hour'
export type RenderPreference = 'auto' | 'presentation' | 'balanced'

export type SceneLayerState = {
  communication: boolean
  riskCorridor: boolean
  vehicleState: boolean
  infrastructure: boolean
}

export type PresentationEnvironmentDefinition = {
  label: string
  shortLabel: string
  description: string
  evidenceNote: string
}

export type PresentationEnvironmentVisuals = {
  background: string
  fog: [string, number, number]
  sky: boolean
  hemisphere: [string, string, number]
  ambient: [string, number]
  sun: [string, number]
  exposure: number
}

export const DEFAULT_PRESENTATION_ENVIRONMENT: PresentationEnvironment = 'open_highway'
export const DEFAULT_PRESENTATION_ATMOSPHERE: PresentationAtmosphere = 'clear_day'
export const DEFAULT_RENDER_PREFERENCE: RenderPreference = 'auto'
export const DEFAULT_SCENE_LAYERS: SceneLayerState = {
  communication: true,
  riskCorridor: true,
  vehicleState: true,
  infrastructure: true,
}

export const PRESENTATION_ATMOSPHERES: Record<PresentationAtmosphere, {
  label: string
  description: string
}> = {
  clear_day: { label: 'Clear Day', description: 'Crisp daylight and long-range visibility' },
  overcast_haze: { label: 'Overcast Haze', description: 'Soft shadows and restrained atmospheric depth' },
  golden_hour: { label: 'Golden Hour', description: 'Low warm sunlight with cooler ambient fill' },
}

export const PRESENTATION_ATMOSPHERE_ORDER: readonly PresentationAtmosphere[] = [
  'clear_day', 'overcast_haze', 'golden_hour',
]

export const RENDER_PREFERENCES: Record<RenderPreference, {
  label: string
  description: string
}> = {
  auto: { label: 'Auto', description: 'Adapts after measuring stable frame timing' },
  presentation: { label: 'Presentation', description: 'Higher detail and shadow resolution' },
  balanced: { label: 'Balanced', description: 'Stable dual-view classroom rendering' },
}

export const PRESENTATION_ENVIRONMENTS: Record<
  PresentationEnvironment,
  PresentationEnvironmentDefinition
> = {
  open_highway: {
    label: 'Open Highway',
    shortLabel: 'Open Road',
    description: 'Open skyline, vegetation, and standard highway infrastructure',
    evidenceNote: 'Visual environment only; vehicle, incident, and network inputs are unchanged',
  },
  city_elevated: {
    label: 'Urban Elevated Highway',
    shortLabel: 'Elevated Road',
    description: 'Elevated structure, sound barriers, and an urban skyline',
    evidenceNote: 'Uses the same highway geometry and PPO decision',
  },
  tunnel: {
    label: 'Tunnel',
    shortLabel: 'Tunnel',
    description: 'Tunnel lighting, emergency facilities, and reflective markings',
    evidenceNote: 'Changes 3D presentation only; no tunnel-specific channel model is enabled',
  },
}

export const PRESENTATION_ENVIRONMENT_ORDER: readonly PresentationEnvironment[] = [
  'open_highway',
  'city_elevated',
  'tunnel',
]

const PRESENTATION_ENVIRONMENT_VISUALS: Record<
  PresentationEnvironment,
  PresentationEnvironmentVisuals
> = {
  open_highway: {
    background: '#aebdc4', fog: ['#aebcc2', 62, 218], sky: true,
    hemisphere: ['#dcecf3', '#59665a', 1.18], ambient: ['#dbe5e8', 0.2],
    sun: ['#fff4df', 2.65], exposure: 0.94,
  },
  city_elevated: {
    background: '#94a7b0', fog: ['#94a7b0', 52, 176], sky: true,
    hemisphere: ['#d8e7ed', '#4c555b', 1.05], ambient: ['#d6e1e5', 0.24],
    sun: ['#f8f0df', 2.25], exposure: 0.9,
  },
  tunnel: {
    background: '#20282d', fog: ['#20282d', 38, 138], sky: false,
    hemisphere: ['#afc5cf', '#20272b', 0.62], ambient: ['#b8ccd3', 0.42],
    sun: ['#dcecf2', 0.82], exposure: 1.1,
  },
}

export function presentationEnvironmentDefinition(environment: PresentationEnvironment) {
  return PRESENTATION_ENVIRONMENTS[environment]
}

export function presentationEnvironmentVisuals(environment: PresentationEnvironment,
  atmosphere: PresentationAtmosphere = DEFAULT_PRESENTATION_ATMOSPHERE) {
  const base = PRESENTATION_ENVIRONMENT_VISUALS[environment]
  if (environment === 'tunnel') return base
  if (atmosphere === 'overcast_haze') return {
    ...base,
    background: environment === 'city_elevated' ? '#87979f' : '#9aa8ad',
    fog: [environment === 'city_elevated' ? '#87979f' : '#9aa8ad', 38, 145] as [string, number, number],
    hemisphere: ['#cad8de', '#555d59', 1.04] as [string, string, number],
    ambient: ['#d4dde0', 0.3] as [string, number],
    sun: ['#e8eceb', 1.25] as [string, number],
    exposure: 0.88,
  }
  if (atmosphere === 'golden_hour') return {
    ...base,
    background: environment === 'city_elevated' ? '#b79b86' : '#c5a58a',
    fog: [environment === 'city_elevated' ? '#b79b86' : '#c5a58a', 50, 188] as [string, number, number],
    hemisphere: ['#f3c99f', '#4f5e68', 0.92] as [string, string, number],
    ambient: ['#b7c8d4', 0.2] as [string, number],
    sun: ['#ffb86b', 3.05] as [string, number],
    exposure: 0.91,
  }
  return base
}
