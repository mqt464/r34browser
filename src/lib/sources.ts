import type { SourceId } from '../types'

export const SOURCE_LABELS: Record<SourceId, string> = {
  rule34: 'Rule34',
  realbooru: 'Realbooru',
}

export const SOURCE_ICONS: Record<SourceId, string> = {
  rule34: `${import.meta.env.BASE_URL}providers/rule34.ico`,
  realbooru: `${import.meta.env.BASE_URL}providers/realbooru.ico`,
}

export function createStorageKey(source: SourceId, id: number) {
  return `${source}:${id}`
}

export function parseStorageKey(storageKey: string) {
  const [source, id] = storageKey.split(':', 2)
  if ((source !== 'rule34' && source !== 'realbooru') || !id) {
    return null
  }

  return {
    source,
    id: Number(id),
  } as const
}

export function getSourceLabel(source: SourceId) {
  return SOURCE_LABELS[source]
}
