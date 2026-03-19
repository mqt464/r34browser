import type { ExcludeFilterId, ExcludeFilterState } from '../types'

export type ExcludeFilterDefinition = {
  id: ExcludeFilterId
  label: string
  description: string
  tags: string[]
  defaultEnabled: boolean
}

export const EXCLUDE_FILTERS: ExcludeFilterDefinition[] = [
  {
    id: 'ai',
    label: 'AI-generated',
    description: 'Hide posts tagged as AI-made or AI-assisted.',
    tags: ['ai', 'ai_generated', 'ai-assisted'],
    defaultEnabled: true,
  },
  {
    id: 'scat',
    label: 'Scat',
    description: 'Block scat-tagged posts from the feed and search results.',
    tags: ['scat'],
    defaultEnabled: true,
  },
  {
    id: 'loliShota',
    label: 'Loli / shota',
    description: 'Exclude both loli and shota tags with one switch.',
    tags: ['loli', 'shota'],
    defaultEnabled: false,
  },
]

export const DEFAULT_EXCLUDE_FILTERS = EXCLUDE_FILTERS.reduce<ExcludeFilterState>(
  (state, filter) => {
    state[filter.id] = filter.defaultEnabled
    return state
  },
  {
    ai: false,
    scat: false,
    loliShota: false,
  },
)

export function normalizeExcludeFilters(filters?: Partial<ExcludeFilterState>) {
  return {
    ...DEFAULT_EXCLUDE_FILTERS,
    ...filters,
  }
}

export function getEnabledExcludeTags(excludeFilters: ExcludeFilterState) {
  return EXCLUDE_FILTERS.flatMap((filter) => (excludeFilters[filter.id] ? filter.tags : []))
}
