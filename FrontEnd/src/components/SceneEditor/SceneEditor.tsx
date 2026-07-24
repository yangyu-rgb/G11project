import { ChevronRight, Download, Play, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { EventEditor } from './EventEditor'
import { PRESET_SCENES } from './PresetScenes'
import type {
  EditorScenario,
  EditorTool,
  EditorVehicle,
  EditorEvent,
} from './sceneTypes'
import { editorLimitations, parseEditorScenario } from './sceneTypes'
import { VehicleEditor } from './VehicleEditor'

type SelectedEntity = { kind: 'vehicle' | 'event'; id: string } | null

type SceneEditorProps = {
  scenario: EditorScenario
  editing: boolean
  tool: EditorTool
  selected: SelectedEntity
  visualization: '2d' | '3d'
  running: boolean
  onScenarioChange: (scenario: EditorScenario) => void
  onEditingChange: (editing: boolean) => void
  onToolChange: (tool: EditorTool) => void
  onSelectedChange: (selected: SelectedEntity) => void
  onRun: () => void
  onClose: () => void
  onNotice: (message: string, tone: 'success' | 'error') => void
}

export type { SelectedEntity }

export function SceneEditor({
  scenario,
  editing,
  tool,
  selected,
  visualization,
  running,
  onScenarioChange,
  onEditingChange,
  onToolChange,
  onSelectedChange,
  onRun,
  onClose,
  onNotice,
}: SceneEditorProps) {
  const [collapsed, setCollapsed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const limitations = editorLimitations(scenario)
  const selectedVehicle = selected?.kind === 'vehicle'
    ? scenario.vehicles.find((item) => item.id === selected.id) ?? null : null
  const selectedEvent = selected?.kind === 'event'
    ? scenario.events.find((item) => item.id === selected.id) ?? null : null

  const exportScenario = () => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${scenario.name.replace(/[^A-Za-z0-9\u4e00-\u9fff_-]/g, '_')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    onNotice('场景JSON已导出', 'success')
  }

  const importScenario = async (file: File | undefined) => {
    if (!file) return
    try {
      const next = parseEditorScenario(JSON.parse(await file.text()) as unknown)
      onScenarioChange(next)
      onSelectedChange(null)
      onNotice(`已加载场景“${next.name}”`, 'success')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '场景JSON读取失败', 'error')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const updateVehicle = (vehicle: EditorVehicle) => onScenarioChange({
    ...scenario,
    vehicles: scenario.vehicles.map((item) => item.id === vehicle.id ? vehicle : item),
  })
  const updateEvent = (event: EditorEvent) => onScenarioChange({
    ...scenario,
    events: scenario.events.map((item) => item.id === event.id ? event : item),
  })

  if (collapsed) {
    return <button type="button" className="editor-reopen" onClick={() => setCollapsed(false)}>
      <ChevronRight aria-hidden="true" />打开场景编辑器
    </button>
  }

  return (
    <aside className="scene-editor" aria-label="交互式场景编辑器">
      <div className="scene-editor__header">
        <div><p className="eyebrow">SCENE LAB</p><h2>交互式场景编辑器</h2></div>
        <div>
          <button type="button" aria-label="折叠编辑器" onClick={() => setCollapsed(true)}><ChevronRight /></button>
          <button type="button" aria-label="关闭编辑器" onClick={onClose}><X /></button>
        </div>
      </div>
      <label className="editor-name">场景名称<input value={scenario.name} maxLength={80}
        onChange={(event) => onScenarioChange({ ...scenario, name: event.target.value })} /></label>
      <div className="editor-summary">
        <span>{scenario.vehicles.length}/100 辆车</span><span>{scenario.events.length}/5 个事件</span>
      </div>
      <div className="editor-mode-switch" role="group" aria-label="编辑模式">
        <button type="button" className={!editing ? 'active' : ''} onClick={() => onEditingChange(false)}>查看</button>
        <button type="button" className={editing ? 'active' : ''} onClick={() => onEditingChange(true)}>编辑</button>
      </div>
      {editing && <div className="editor-tools" role="group" aria-label="地图点击工具">
        {([['select', '选择'], ['vehicle', '添加车辆'], ['event', '添加事件']] as const).map(([value, label]) => (
          <button key={value} type="button" className={tool === value ? 'active' : ''}
            onClick={() => onToolChange(value)}>{label}</button>
        ))}
      </div>}
      {editing && visualization === '3d' && <p className="editor-warning">添加位置需要切换到2D地图；3D视图仍可实时预览。</p>}
      <div className="editor-presets">
        <strong>极端场景预设</strong>
        {PRESET_SCENES.map((preset) => <button key={preset.name} type="button" onClick={() => {
          onScenarioChange(structuredClone(preset)); onSelectedChange(null)
        }}>{preset.name}</button>)}
      </div>
      <VehicleEditor vehicle={selectedVehicle} onChange={updateVehicle} onDelete={() => {
        if (!selectedVehicle || scenario.vehicles.length === 1) {
          onNotice('场景必须至少保留1辆车', 'error'); return
        }
        onScenarioChange({ ...scenario, vehicles: scenario.vehicles.filter((item) => item.id !== selectedVehicle.id) })
        onSelectedChange(null)
      }} />
      <EventEditor event={selectedEvent} onChange={updateEvent} onDelete={() => {
        if (!selectedEvent) return
        onScenarioChange({ ...scenario, events: scenario.events.filter((item) => item.id !== selectedEvent.id) })
        onSelectedChange(null)
      }} />
      {limitations.length > 0 && <div className="editor-limit" role="status">
        <strong>仅可本地预览</strong>{limitations.map((item) => <span key={item}>{item}</span>)}
      </div>}
      <div className="editor-actions">
        <button type="button" onClick={exportScenario}><Download />导出JSON</button>
        <button type="button" onClick={() => fileInput.current?.click()}><Upload />导入JSON</button>
        <input ref={fileInput} hidden type="file" accept="application/json,.json"
          onChange={(event) => void importScenario(event.target.files?.[0])} />
        <button type="button" className="editor-run" disabled={limitations.length > 0 || running} onClick={onRun}>
          <Play />{running ? '正在创建…' : '运行AI仿真'}
        </button>
      </div>
    </aside>
  )
}
