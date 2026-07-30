export type PresentationEnvironment = 'open_highway' | 'city_elevated' | 'tunnel'

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

export const PRESENTATION_ENVIRONMENTS: Record<
  PresentationEnvironment,
  PresentationEnvironmentDefinition
> = {
  open_highway: {
    label: '开放高速',
    shortLabel: '开放路段',
    description: '开阔天际线、绿化与标准高速设施',
    evidenceNote: '视觉环境，不改变车辆、事件或网络输入',
  },
  city_elevated: {
    label: '城市高架',
    shortLabel: '高架路段',
    description: '高架桥体、隔音屏与城市建筑群',
    evidenceNote: '沿用同一高速道路几何与PPO决策',
  },
  tunnel: {
    label: '隧道路段',
    shortLabel: '隧道环境',
    description: '隧道灯带、应急设施与反光标线',
    evidenceNote: '仅切换三维表现，不启用隧道信道模型',
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
    hemisphere: ['#afc5cf', '#20272b', 0.46], ambient: ['#b8ccd3', 0.3],
    sun: ['#dcecf2', 0.72], exposure: 1.02,
  },
}

export function presentationEnvironmentDefinition(environment: PresentationEnvironment) {
  return PRESENTATION_ENVIRONMENTS[environment]
}

export function presentationEnvironmentVisuals(environment: PresentationEnvironment) {
  return PRESENTATION_ENVIRONMENT_VISUALS[environment]
}
