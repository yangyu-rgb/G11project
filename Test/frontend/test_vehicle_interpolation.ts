import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  interpolateHeading,
  lerp,
  smoothstep,
  smoothstepProgress,
} from '../../FrontEnd/src/utils/interpolation.ts'

describe('vehicle interpolation', () => {
  it('interpolates scalar values and clamps smoothstep input', () => {
    assert.equal(lerp(10, 20, 0.25), 12.5)
    assert.equal(smoothstepProgress(-1), 0)
    assert.equal(smoothstepProgress(0.5), 0.5)
    assert.equal(smoothstepProgress(2), 1)
    assert.equal(smoothstep(10, 20, 0.5), 15)
  })

  it('rotates across zero using the shortest heading path', () => {
    assert.equal(interpolateHeading(350, 10, 0.5), 0)
    assert.equal(interpolateHeading(10, 350, 0.5), 0)
  })

  it('smoothly interpolates between arbitrary endpoints', () => {
    assert.equal(smoothstep(10, 30, 0), 10)
    assert.equal(smoothstep(10, 30, 0.25), 13.125)
    assert.equal(smoothstep(10, 30, 1), 30)
  })
})
