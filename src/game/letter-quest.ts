export type LetterQuestState = 'SEARCHING_LETTER' | 'LETTER_READ'
export type LetterQuestEvent = 'read-letter'

export const INITIAL_LETTER_QUEST_STATE: LetterQuestState = 'SEARCHING_LETTER'

/** Pure progression for the optional birthday-letter quest in the Tulip Garden. */
export function advanceLetterQuest(state: LetterQuestState, event: LetterQuestEvent): LetterQuestState {
  if (state === 'SEARCHING_LETTER' && event === 'read-letter') return 'LETTER_READ'
  return state
}
 