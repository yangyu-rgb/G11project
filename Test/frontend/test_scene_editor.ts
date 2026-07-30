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
import {
  DEFAULT_PRESENTATION_ATMOSPHERE,
  DEFAULT_PRESENTATION_ENVIRONMENT,
  DEFAULT_RENDER_PREFERENCE,
  DEFAULT_SCENE_LAYERS,
  PRESENTATION_ATMOSPHERE_ORDER,
  PRESENTATION_ENVIRONMENT_ORDER,
  PRESENTATION_ENVIRONMENTS,
  RENDER_PREFERENCES,
  presentationEnvironmentVisuals,
} from '../../FrontEnd/src/components/ThreeD/environmentPresets.ts'

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
    assert.throws(() => parseEditorScenario(invalid), /IDs must each be unique/)
  })

  it('keeps environment presets visual-only and outside the simulation scenario', () => {
    assert.equal(DEFAULT_PRESENTATION_ENVIRONMENT, 'open_highway')
    assert.deepEqual(PRESENTATION_ENVIRONMENT_ORDER, [
      'open_highway', 'city_elevated', 'tunnel',
    ])
    const referenceScenario = JSON.stringify(buildHighwayPresentationScenario('dense'))
    for (const environment of PRESENTATION_ENVIRONMENT_ORDER) {
      const definition = PRESENTATION_ENVIRONMENTS[environment]
      assert(definition.label.length > 0)
      assert.match(definition.evidenceNote, /Visual|same|Changes/)
      assert.equal(JSON.stringify(buildHighwayPresentationScenario('dense')), referenceScenario)
      assert.equal('environmentPreset' in buildHighwayPresentationScenario('dense'), false)
    }
    assert.equal(new Set(PRESENTATION_ENVIRONMENT_ORDER.map(
      (environment) => presentationEnvironmentVisuals(environment).background,
    )).size, PRESENTATION_ENVIRONMENT_ORDER.length)
    assert.equal(presentationEnvironmentVisuals('tunnel').sky, false)
  })

  it('keeps atmosphere, quality, and evidence layers presentation-only', () => {
    assert.equal(DEFAULT_PRESENTATION_ATMOSPHERE, 'clear_day')
    assert.equal(DEFAULT_RENDER_PREFERENCE, 'auto')
    assert.deepEqual(PRESENTATION_ATMOSPHERE_ORDER, [
      'clear_day', 'overcast_haze', 'golden_hour',
    ])
    assert.deepEqual(DEFAULT_SCENE_LAYERS, {
      communication: true,
      riskCorridor: true,
      vehicleState: true,
      infrastructure: true,
    })
    assert.deepEqual(Object.keys(RENDER_PREFERENCES), ['auto', 'presentation', 'balanced'])
    const referenceScenario = JSON.stringify(buildHighwayPresentationScenario('dense'))
    for (const atmosphere of PRESENTATION_ATMOSPHERE_ORDER) {
      const open = presentationEnvironmentVisuals('open_highway', atmosphere)
      assert(open.sun[1] > 0)
      assert(open.fog[2] > open.fog[1])
      assert.equal(JSON.stringify(buildHighwayPresentationScenario('dense')), referenceScenario)
    }
    assert.equal(
      presentationEnvironmentVisuals('tunnel', 'golden_hour'),
      presentationEnvironmentVisuals('tunnel', 'clear_day'),
    )
  })
})
