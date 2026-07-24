import type { EditorVehicle } from './sceneTypes'

type VehicleEditorProps = {
  vehicle: EditorVehicle | null
  onChange: (vehicle: EditorVehicle) => void
  onDelete: () => void
}

export function VehicleEditor({ vehicle, onChange, onDelete }: VehicleEditorProps) {
  if (!vehicle) return <p className="editor-empty">选择一辆车后可修改速度、航向和坐标。</p>
  const numberChange = (field: keyof EditorVehicle, value: string) => {
    onChange({ ...vehicle, [field]: Number(value) })
  }
  return (
    <fieldset className="entity-editor">
      <legend>车辆 {vehicle.id}</legend>
      <div className="editor-field-grid">
        <label>X（米）<input type="number" value={vehicle.x} min={-10000} max={10000}
          onChange={(event) => numberChange('x', event.target.value)} /></label>
        <label>Y（米）<input type="number" value={vehicle.y} min={-10000} max={10000}
          onChange={(event) => numberChange('y', event.target.value)} /></label>
        <label>速度（km/h）<input type="number" value={vehicle.speed_kmh} min={0} max={150}
          onChange={(event) => numberChange('speed_kmh', event.target.value)} /></label>
        <label>航向（°）<input type="number" value={vehicle.heading} min={0} max={359}
          onChange={(event) => numberChange('heading', event.target.value)} /></label>
      </div>
      <button type="button" className="editor-danger" onClick={onDelete}>删除车辆</button>
    </fieldset>
  )
}
