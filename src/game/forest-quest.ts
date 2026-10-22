export type ForestQuestState = 'SEARCHING_KEY' | 'KEY_FOUND' | 'LEVEL_COMPLETE'
export type ForestQuestEvent = 'find-key' | 'open-gate'
export const INITIAL_FOREST_QUEST_STATE: ForestQuestState = 'SEARCHING_KEY'

/** Pure quest state transition function; level visuals and interaction ranges stay in ForestLevel. */
export function advanceForestQuest(state: ForestQuestState, event: ForestQuestEvent): ForestQuestState {
  if (state === 'SEARCHING_KEY' && event === 'find-key') return 'KEY_FOUND'
  if (state === 'KEY_FOUND' && event === 'open-gate') return 'LEVEL_COMPLETE'
  return state
}
