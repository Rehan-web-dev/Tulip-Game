import { describe, expect, it } from 'vitest'
import { advanceLetterQuest, INITIAL_LETTER_QUEST_STATE } from '../src/game/letter-quest'

describe('birthday letter quest', () => {
  it('starts by searching for the letter', () => {
    expect(INITIAL_LETTER_QUEST_STATE).toBe('SEARCHING_LETTER')
  })

  it('marks the objective complete after reading, and stays complete on reread', () => {
    expect(advanceLetterQuest('SEARCHING_LETTER', 'read-letter')).toBe('LETTER_READ')
    expect(advanceLetterQuest('LETTER_READ', 'read-letter')).toBe('LETTER_READ')
  })
})
