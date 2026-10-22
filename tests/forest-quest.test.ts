import { describe, expect, it } from 'vitest'
import { advanceForestQuest, INITIAL_FOREST_QUEST_STATE } from '../src/game/forest-quest'

describe('Dark Forest quest state machine', () => {
  it('starts by searching for the Forest Key', () => {
    expect(INITIAL_FOREST_QUEST_STATE).toBe('SEARCHING_KEY')
  })

  it('does not unlock the gate before Raven finds the key', () => {
    expect(advanceForestQuest('SEARCHING_KEY', 'open-gate')).toBe('SEARCHING_KEY')
  })

  it('moves from searching to holding the key', () => {
    expect(advanceForestQuest('SEARCHING_KEY', 'find-key')).toBe('KEY_FOUND')
    expect(advanceForestQuest('KEY_FOUND', 'find-key')).toBe('KEY_FOUND')
  })

  it('marks the forest level complete only after the key opens the gate', () => {
    expect(advanceForestQuest('KEY_FOUND', 'open-gate')).toBe('LEVEL_COMPLETE')
    expect(advanceForestQuest('LEVEL_COMPLETE', 'open-gate')).toBe('LEVEL_COMPLETE')
  })
})
