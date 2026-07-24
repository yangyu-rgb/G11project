import type { EditorEvent, EditorEventType } from './sceneTypes'

type EventEditorProps = {
  event: EditorEvent | null
  onChange: (event: EditorEvent) => void
  onDelete: () => void
}

export function EventEditor({ event, onChange, onDelete }: EventEditorProps) {
  if (!event) return <p className="editor-empty">选择一个事件后可修改类型、时刻和严重度。</p>
  const numberChange = (field: keyof EditorEvent, value: string) => {
    onChange({ ...event, [field]: Number(value) })
  }
  return (
    <fieldset className="entity-editor">
      <legend>事件 {event.id}</legend>
      <label>类型<select value={event.type}
        onChange={(change) => onChange({ ...event, type: change.target.value as EditorEventType })}>
        <option value="emergency_braking">急刹</option>
        <option value="obstacle">障碍物</option>
        <option value="collision_warning">碰撞预警</option>
      </select></label>
      <div className="editor-field-grid">
        <label>X（米）<input type="number" value={event.x} min={-10000} max={10000}
          onChange={(change) => numberChange('x', change.target.value)} /></label>
        <label>Y（米）<input type="number" value={event.y} min={-10000} max={10000}
          onChange={(change) => numberChange('y', change.target.value)} /></label>
        <label>触发时刻（0–9s）<input type="number" value={event.timestamp} min={0} max={9} step={1}
          onChange={(change) => numberChange('timestamp', change.target.value)} /></label>
      </div>
      <label>严重度：{event.severity.toFixed(2)}<input type="range" value={event.severity}
        min={0} max={1} step={0.05} onChange={(change) => numberChange('severity', change.target.value)} /></label>
      <button type="button" className="editor-danger" onClick={onDelete}>删除事件</button>
    </fieldset>
  )
}
