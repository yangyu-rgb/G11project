import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fromMapPosition, toMapPosition } from '../../FrontEnd/src/components/MapView/coordinates.ts'
import { PRESET_SCENES } from '../../FrontEnd/src/components/SceneEditor/PresetScenes.ts'
import {
  editorLimitations,
  parseEditorScenario,
} from '../../FrontEnd/src/components/SceneEditor/sceneTypes.ts'

describe('map projection', () => {
  it('round-trips SUMO metre coordinates through latitude and longitude', () => {
    const [latitude, longitude] = toMapPosition(2500, 500)
    const local = fromMapPosition(latitude, longitude)
    assert.ok(Math.abs(local.x - 2500) < 0.001)
    assert.ok(Math.abs(local.y - 500) < 0.001)
  })
})

describe('scene editor presets and validation', () => {
  it('builds the required 100-vehicle and five-event presets', () => {
    assert.equal(PRESET_SCENES[0].vehicles.length, 100)
    assert.equal(PRESET_SCENES[1].events.length, 5)
    assert.equal(editorLimitations(PRESET_SCENES[0]).length, 1)
    assert.equal(editorLimitations(PRESET_SCENES[1]).length, 1)
  })

  it('places every boundary-test vehicle exactly 300 metres from the event', () => {
    const scenario = PRESET_SCENES[2]
    const event = scenario.events[0]
    for (const vehicle of scenario.vehicles) {
      assert.ok(Math.abs(Math.hypot(vehicle.x - event.x, vehicle.y - event.y) - 300) < 1e-9)
    }
  })

  it('accepts version one JSON and rejects duplicate vehicle IDs', () => {
    assert.equal(parseEditorScenario(structuredClone(PRESET_SCENES[2])).schema_version, 1)
    const invalid = structuredClone(PRESET_SCENES[2])
    invalid.vehicles[1].id = invalid.vehicles[0].id
    assert.throws(() => parseEditorScenario(invalid), /ID必须各自唯一/)
  })
})
