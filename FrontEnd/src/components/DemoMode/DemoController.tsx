import { ChevronLeft, ChevronRight, Pause, Play, Repeat2 } from 'lucide-react'

import type { DemoScenario } from './DemoScenarios'

type DemoControllerProps = {
  scenarios: DemoScenario[]
  activeIndex: number
  playing: boolean
  loop: boolean
  speed: number
  onSelect: (index: number) => void
  onPlayPause: () => void
  onLoopChange: (loop: boolean) => void
  onSpeedChange: (speed: number) => void
}

export function DemoController({ scenarios, activeIndex, playing, loop, speed, onSelect, onPlayPause, onLoopChange, onSpeedChange }: DemoControllerProps) {
  const active = scenarios[activeIndex]
  const move = (direction: number) => {
    const availableIndexes = scenarios
      .map((scenario, index) => ({ scenario, index }))
      .filter((item) => item.scenario.available)
      .map((item) => item.index)
    if (!availableIndexes.length) return
    const position = availableIndexes.indexOf(activeIndex)
    const normalizedPosition = position < 0 ? 0 : position
    onSelect(availableIndexes[(normalizedPosition + direction + availableIndexes.length) % availableIndexes.length])
  }
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
        <button type="button" onClick={() => move(-1)} aria-label="上一个场景"><ChevronLeft /></button>
        <button type="button" className="demo-play" onClick={onPlayPause} disabled={!active?.available}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? '暂停' : '播放'}
        </button>
        <button type="button" onClick={() => move(1)} aria-label="下一个场景"><ChevronRight /></button>
        <button type="button" className={loop ? 'demo-loop demo-loop--active' : 'demo-loop'}
          aria-pressed={loop} onClick={() => onLoopChange(!loop)}><Repeat2 aria-hidden="true" />循环</button>
        {[1, 2, 5].map((option) => (
          <button key={option} type="button" aria-pressed={speed === option}
            className={speed === option ? 'demo-speed demo-speed--active' : 'demo-speed'}
            onClick={() => onSpeedChange(option)}>{option}x</button>
        ))}
      </div>
    </section>
  )
}
