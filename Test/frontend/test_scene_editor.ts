import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildHighwayPresentationScenario,
  HIGHWAY_PRESENTATION_SCENARIO,
  PRESENTATION_DENSITIES,
  PRESENTATION_ROW_SPACING_METERS,
  PRESET_SCENES,
  recommendedIncidentVehicleId,
  withEmergencyIncident,
} from '../../FrontEnd/src/components/SceneEditor/PresetScenes.ts'
import {
  editorLimitations,
  parseEditorScenario,
} from '../../FrontEnd/src/components/SceneEditor/sceneTypes.ts'

describe('scene data validation', () => {
  it('defaults to the dense presentation within the real model limit', () => {
    assert.equal(HIGHWAY_PRESENTATION_SCENARIO.vehicles.length, 50)
    assert.deepEqual(editorLimitations(HIGHWAY_PRESENTATION_SCENARIO), [])
    for (const lane of [-8, -4.8, -1.6]) {
      const positions = HIGHWAY_PRESENTATION_SCENARIO.vehicles
        .filter((vehicle) => vehicle.y === lane)
        .map((vehicle) => vehicle.x)
        .sort((left, right) => left - right)
      assert(positions.every((value, index) => (
        index === 0 || value - positions[index - 1] === PRESENTATION_ROW_SPACING_METERS
      )))
    }
  })

  it('builds deterministic in-distribution density scenarios', () => {
    const expectedSources = { light: 'vehicle_018', medium: 'vehicle_024', dense: 'vehicle_036' }
    for (const [density, expected] of Object.entries(PRESENTATION_DENSITIES)) {
      const scenario = buildHighwayPresentationScenario(
        density as keyof typeof PRESENTATION_DENSITIES,
      )
      assert.equal(scenario.vehicles.length, expected.vehicleCount)
      assert.deepEqual(editorLimitations(scenario), [])
      for (const lane of [-8, -4.8, -1.6]) {
        const positions = scenario.vehicles.filter((item) => item.y === lane)
          .map((item) => item.x).sort((left, right) => left - right)
        assert(positions.every((value, index) => (
          index === 0 || value - positions[index - 1] === PRESENTATION_ROW_SPACING_METERS
        )))
      }
      assert.equal(
        recommendedIncidentVehicleId(scenario),
        expectedSources[density as keyof typeof expectedSources],
      )
    }
  })

  it('binds a 96-to-18 km/h emergency event to the selected vehicle', () => {
    const selected = HIGHWAY_PRESENTATION_SCENARIO.vehicles[17]
    const configured = withEmergencyIncident(HIGHWAY_PRESENTATION_SCENARIO, selected.id)
    assert.equal(configured.events[0].source_vehicle_id, selected.id)
    assert.equal(configured.events[0].pre_brake_speed_kmh, 96)
    assert.equal(configured.events[0].post_brake_speed_kmh, 18)
    assert.equal(configured.vehicles.find((vehicle) => vehicle.id === selected.id)?.speed_kmh, 96)
    assert.equal(parseEditorScenario(structuredClone(configured)).events.length, 1)
  })

  it('continues to accept existing version-one presets and reject duplicate IDs', () => {
    assert.equal(parseEditorScenario(structuredClone(PRESET_SCENES[2])).schema_version, 1)
    const invalid = structuredClone(PRESET_SCENES[2])
    invalid.vehicles[1].id = invalid.vehicles[0].id
    assert.throws(() => parseEditorScenario(invalid), /ID必须各自唯一/)
  })
})
