import type { TagMeta, TagTypeKey } from '../types'

interface TagTypeDetails {
  key: TagTypeKey
  label: string
}

const TAG_TYPE_LOOKUP: Record<number, TagTypeDetails> = {
  0: { key: 'general', label: 'General' },
  1: { key: 'artist', label: 'Artist' },
  3: { key: 'copyright', label: 'Copyright' },
  4: { key: 'character', label: 'Character' },
  5: { key: 'meta', label: 'Meta' },
  6: { key: 'deprecated', label: 'Deprecated' },
}

const TAG_TYPE_NAME_LOOKUP: Record<string, number> = {
  artist: 1,
  character: 4,
  copyright: 3,
  deprecated: 6,
  general: 0,
  meta: 5,
  metadata: 5,
}

const TAG_TYPE_SORT_ORDER: Record<TagTypeKey, number> = {
  copyright: 0,
  artist: 1,
  character: 2,
  general: 3,
  meta: 4,
  deprecated: 5,
  unknown: 6,
}

export function normalizeTagType(value: number | string | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return 0
  }

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return 0
  }

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return numeric
  }

  return TAG_TYPE_NAME_LOOKUP[trimmed] ?? 0
}

export function getTagTypeDetails(type: number): TagTypeDetails {
  return TAG_TYPE_LOOKUP[type] ?? { key: 'unknown', label: 'Other' }
}

export function sortTagsByCategory(tags: string[], meta: Map<string, TagMeta>) {
  return [...tags].sort((left, right) => {
    const leftOrder = TAG_TYPE_SORT_ORDER[getTagTypeDetails(meta.get(left)?.type ?? 0).key]
    const rightOrder = TAG_TYPE_SORT_ORDER[getTagTypeDetails(meta.get(right)?.type ?? 0).key]

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    return left.localeCompare(right)
  })
}
