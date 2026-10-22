import { describe, expect, it } from 'vitest'
import { generateTulipPlacements, isOnGardenPath, seeded } from '../src/game/world'

describe('garden layout generation', () => {
  it('keeps decorative randomness deterministic for the same garden seed', () => {
    const first = seeded(240816)
    const second = seeded(240816)
    const a = Array.from({ length: 64 }, () => first())
    const b = Array.from({ length: 64 }, () => second())

    expect(a).toEqual(b)
    expect(a.every(value => value >= 0 && value < 1)).toBe(true)
  })

  it('uses different placements for a different seed', () => {
    expect(seeded(240816)()).not.toBe(seeded(240817)())
  })

  it('marks the central, side, and cottage paths plus their clear margins as flower-free', () => {
    for (const [x, z] of [[0, -3], [2.7, 8], [-8, -7.5], [9, 0.5], [0, 18], [0.16, 12]] as const) {
      expect(isOnGardenPath(x, z)).toBe(true)
    }
    expect(isOnGardenPath(-20, 0)).toBe(false)
    expect(isOnGardenPath(20, 20)).toBe(false)
  })

  it('fills both garden sides evenly without crowding the walkways or autumn swing clearing', () => {
    const placements = generateTulipPlacements(seeded(240816), 100)
    const left = placements.filter(flower => flower.x < 0)
    const right = placements.filter(flower => flower.x > 0)

    expect(placements).toHaveLength(200)
    expect(left).toHaveLength(100)
    expect(right).toHaveLength(100)
    expect(placements.every(flower => !isOnGardenPath(flower.x, flower.z))).toBe(true)
    expect(placements.every(flower => Math.hypot(flower.x - 10.2, flower.z + 21.8) >= 6)).toBe(true)
  })
})
