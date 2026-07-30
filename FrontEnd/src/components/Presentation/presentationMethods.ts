import type { ComparisonBaseline } from '../../types/simulation'

export type BaselineDefinition = {
  id: ComparisonBaseline
  label: string
  shortLabel: string
  description: string
  rule: string
}

export const BASELINE_DEFINITIONS: readonly BaselineDefinition[] = [
  {
    id: 'broadcast',
    label: '全量广播',
    shortLabel: 'BROADCAST',
    description: '向通信域内全部非事故车辆发送消息，覆盖范围最大。',
    rule: '全部非发送车辆',
  },
  {
    id: 'distance',
    label: '固定范围',
    shortLabel: 'DISTANCE · 300 m',
    description: '通知事故点300米内全部车辆，固定高优先级并使用100%总带宽。',
    rule: '欧氏距离 ≤ 300 m · 固定资源',
  },
  {
    id: 'urgency',
    label: '紧急度调度',
    shortLabel: 'URGENCY',
    description: '接收集合仍为300米范围，依据事件严重度调整优先级与总带宽比例。',
    rule: '同一距离筛选 · 严重度调度资源',
  },
] as const

export function baselineDefinition(method: ComparisonBaseline | undefined): BaselineDefinition {
  return BASELINE_DEFINITIONS.find((item) => item.id === method) ?? BASELINE_DEFINITIONS[0]
}
