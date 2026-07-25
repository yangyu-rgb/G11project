import { ChevronLeft, ChevronRight, Pause, Play, Repeat2 } from 'lucide-react'

import type { DemoScenario } from './DemoScenarios'
import { NARRATIVE_DURATION_MS, type NarrativeStageConfig } from './NarrativeStages'

type DemoControllerProps = {
  scenarios: DemoScenario[]
  activeIndex: number
  playing: boolean
  loop: boolean
  stage: NarrativeStageConfig
  elapsedMs: number
  onSelect: (index: number) => void
  onPlayPause: () => void
  onStageMove: (direction: -1 | 1) => void
  onLoopChange: (loop: boolean) => void
}

export function DemoController({ scenarios, activeIndex, playing, loop, stage, elapsedMs, onSelect, onPlayPause, onStageMove, onLoopChange }: DemoControllerProps) {
  const active = scenarios[activeIndex]
  const progress = Math.min(100, (elapsedMs / NARRATIVE_DURATION_MS) * 100)
  return (
    <section className="demo-controller" aria-label="自动演示控制器">
      <div className="demo-scenario-copy">
        <p className="eyebrow">PRESENTATION MODE</p>
        <strong>{active?.title ?? '正在读取场景'}</strong>
        <span>{active?.description}</span>
      </div>
      <div className="demo-scenario-tabs" role="tablist" aria-label="演示场景">
        {scenarios.map((scenario, index) => (
          <button key={scenario.id} type="button" role="tab" aria-selected={index === activeIndex}
            className={index === activeIndex ? 'demo-tab demo-tab--active' : 'demo-tab'}
            onClick={() => onSelect(index)} disabled={!scenario.available}
            title={scenario.available ? scenario.description : `等待正式${scenario.missing.join('、')}`}>
            {index + 1}. {scenario.title}{!scenario.available ? ' · 待资源' : ''}
          </button>
        ))}
      </div>
      <div className="demo-actions">
        <button type="button" onClick={() => onStageMove(-1)} aria-label="上一个叙事阶段"><ChevronLeft /></button>
        <button type="button" className="demo-play" onClick={onPlayPause} disabled={!active?.available}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? '暂停' : '播放'}
        </button>
        <button type="button" onClick={() => onStageMove(1)} aria-label="下一个叙事阶段"><ChevronRight /></button>
        <button type="button" className={loop ? 'demo-loop demo-loop--active' : 'demo-loop'}
          aria-pressed={loop} onClick={() => onLoopChange(!loop)}><Repeat2 aria-hidden="true" />循环</button>
      </div>
      <div className="narrative-progress" aria-label={`当前${stage.title}，${Math.floor(elapsedMs / 1000)}秒，共60秒`}>
        <div><strong>{stage.shortTitle}</strong><span>{Math.floor(elapsedMs / 1000)} / 60s</span></div>
        <progress max="100" value={progress}>{progress.toFixed(0)}%</progress>
      </div>
    </section>
  )
}
