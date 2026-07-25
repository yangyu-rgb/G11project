import { useEffect, useMemo, useRef, useState } from 'react'

export enum NarrativeStage {
  OPENING = 'opening',
  DANGER_APPROACHING = 'danger_approaching',
  EVENT_TRIGGERED = 'event_triggered',
  AI_SCANNING = 'ai_scanning',
  AI_DECIDING = 'ai_deciding',
  MESSAGES_FLYING = 'messages_flying',
  SUCCESS = 'success',
  COMPARISON = 'comparison',
}

export type NarrativeStageConfig = {
  stage: NarrativeStage
  title: string
  shortTitle: string
  startMs: number
  endMs: number
}

export const NARRATIVE_DURATION_MS = 60_000

export const NARRATIVE_STAGES: NarrativeStageConfig[] = [
  { stage: NarrativeStage.OPENING, title: '阶段1：正常行驶', shortTitle: '开场', startMs: 0, endMs: 5_000 },
  { stage: NarrativeStage.DANGER_APPROACHING, title: '阶段2：危险正在逼近', shortTitle: '危险逼近', startMs: 5_000, endMs: 10_000 },
  { stage: NarrativeStage.EVENT_TRIGGERED, title: '阶段3：紧急事件发生', shortTitle: '事件触发', startMs: 10_000, endMs: 13_000 },
  { stage: NarrativeStage.AI_SCANNING, title: '阶段4：AI扫描关键车辆', shortTitle: 'AI扫描', startMs: 13_000, endMs: 18_000 },
  { stage: NarrativeStage.AI_DECIDING, title: '阶段5：AI完成通信决策', shortTitle: 'AI决策', startMs: 18_000, endMs: 23_000 },
  { stage: NarrativeStage.MESSAGES_FLYING, title: '阶段6：安全消息传播', shortTitle: '消息传播', startMs: 23_000, endMs: 35_000 },
  { stage: NarrativeStage.SUCCESS, title: '阶段7：关键车辆成功接收', shortTitle: '成功送达', startMs: 35_000, endMs: 45_000 },
  { stage: NarrativeStage.COMPARISON, title: '阶段8：AI与传统方法对比', shortTitle: '方法对比', startMs: 45_000, endMs: 60_000 },
]

export function narrativeStageAt(elapsedMs: number): NarrativeStageConfig {
  return NARRATIVE_STAGES.find((stage) => elapsedMs >= stage.startMs && elapsedMs < stage.endMs)
    ?? NARRATIVE_STAGES[NARRATIVE_STAGES.length - 1]
}

export function useNarrativeTimeline(active: boolean, playing: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const elapsedRef = useRef(0)
  const previousTick = useRef<number | null>(null)

  useEffect(() => {
    if (!active || !playing) {
      previousTick.current = null
      return
    }
    const timer = window.setInterval(() => {
      const now = performance.now()
      const previous = previousTick.current ?? now
      previousTick.current = now
      elapsedRef.current = Math.min(NARRATIVE_DURATION_MS, elapsedRef.current + now - previous)
      setElapsedMs(elapsedRef.current)
    }, 100)
    return () => window.clearInterval(timer)
  }, [active, playing])

  const seekStage = (direction: -1 | 1) => {
    const current = narrativeStageAt(elapsedRef.current)
    const index = NARRATIVE_STAGES.findIndex((stage) => stage.stage === current.stage)
    const target = NARRATIVE_STAGES[Math.min(NARRATIVE_STAGES.length - 1, Math.max(0, index + direction))]
    elapsedRef.current = target.startMs
    setElapsedMs(target.startMs)
  }

  const reset = () => {
    elapsedRef.current = 0
    previousTick.current = null
    setElapsedMs(0)
  }

  return useMemo(() => ({
    elapsedMs,
    stage: narrativeStageAt(elapsedMs),
    seekStage,
    reset,
    complete: elapsedMs >= NARRATIVE_DURATION_MS,
  }), [elapsedMs])
}
