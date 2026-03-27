import { openDB } from 'idb'
import { DEFAULT_EXCLUDE_FILTERS, normalizeExcludeFilters } from './preferences'
import { normalizeRealbooruProxyUrl } from './realbooruProxy'
import { createStorageKey } from './sources'
import type { FeedSignals, LocalLibraryItem, UserPreferences } from '../types'

const DB_NAME = 'r34browser'
const DB_VERSION = 3
const PREFERENCES_KEY = 'r34browser.preferences'
const FEED_SIGNALS_KEY = 'r34browser.feedSignals'
const TIMESTAMP_INDEX = 'by-timestamp'

type LegacyPostStoreName = 'saved' | 'history' | 'downloads'
type PostStoreName = 'savedItems' | 'historyItems' | 'downloadItems'
export type LibraryCursor = [number, string]

const LEGACY_POST_STORES: LegacyPostStoreName[] = ['saved', 'history', 'downloads']
const POST_STORES: Record<'saved' | 'history' | 'downloads', PostStoreName> = {
  saved: 'savedItems',
  history: 'historyItems',
  downloads: 'downloadItems',
}

const defaultPreferences: UserPreferences = {
  rule34Credentials: {
    userId: '',
    apiKey: '',
  },
  defaultSource: 'rule34',
  searchSource: 'rule34',
  realbooruProxyUrl: normalizeRealbooruProxyUrl(undefined),
  excludeFilters: DEFAULT_EXCLUDE_FILTERS,
  masonryColumns: 1,
  hapticsEnabled: true,
  autoplayEnabled: false,
  preferShareOnMobile: true,
  accentColor: '#4f8cff',
}

type LegacyLibraryItem = Omit<LocalLibraryItem, 'source' | 'storageKey'> & {
  id: number
}

function toRule34StorageKey(id: number) {
  return createStorageKey('rule34', id)
}

function migrateLibraryRecord(record: LegacyLibraryItem, kind: LocalLibraryItem['kind']): LocalLibraryItem {
  return {
    ...record,
    kind,
    source: 'rule34',
    storageKey: toRule34StorageKey(record.id),
    sourceUrl: record.sourceUrl ?? '',
  }
}

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(database, oldVersion, _newVersion, transaction) {
      const ensurePostStore = (storeName: PostStoreName) => {
        const store = database.objectStoreNames.contains(storeName)
          ? transaction.objectStore(storeName)
          : database.createObjectStore(storeName, { keyPath: 'storageKey' })

        if (!store.indexNames.contains(TIMESTAMP_INDEX)) {
          store.createIndex(TIMESTAMP_INDEX, ['timestamp', 'storageKey'])
        }

        return store
      }

      const savedStore = ensurePostStore('savedItems')
      const historyStore = ensurePostStore('historyItems')
      const downloadStore = ensurePostStore('downloadItems')

      if (!database.objectStoreNames.contains('hiddenItems')) {
        database.createObjectStore('hiddenItems')
      }
      if (!database.objectStoreNames.contains('mutedTags')) {
        database.createObjectStore('mutedTags', { keyPath: 'tag' })
      }

      if (oldVersion < 3) {
        const legacySaved = database.objectStoreNames.contains('saved')
          ? ((await transaction.objectStore('saved').getAll()) as LegacyLibraryItem[])
          : []
        const legacyHistory = database.objectStoreNames.contains('history')
          ? ((await transaction.objectStore('history').getAll()) as LegacyLibraryItem[])
          : []
        const legacyDownloads = database.objectStoreNames.contains('downloads')
          ? ((await transaction.objectStore('downloads').getAll()) as LegacyLibraryItem[])
          : []
        const legacyHidden = database.objectStoreNames.contains('hidden')
          ? ((await transaction.objectStore('hidden').getAllKeys()) as number[])
          : []

        for (const record of legacySaved) {
          await savedStore.put(migrateLibraryRecord(record, 'saved'))
        }
        for (const record of legacyHistory) {
          await historyStore.put(migrateLibraryRecord(record, 'history'))
        }
        for (const record of legacyDownloads) {
          await downloadStore.put(migrateLibraryRecord(record, 'downloaded'))
        }

        const hiddenStore = transaction.objectStore('hiddenItems')
        for (const id of legacyHidden) {
          await hiddenStore.put(Date.now(), toRule34StorageKey(id))
        }
      }
    },
  })
}

function sortLibrary(items: LocalLibraryItem[]) {
  return items.sort((left, right) => right.timestamp - left.timestamp)
}

export function loadPreferences() {
  const rawValue = localStorage.getItem(PREFERENCES_KEY)
  if (!rawValue) {
    return defaultPreferences
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<UserPreferences> & {
      credentials?: UserPreferences['rule34Credentials']
    }

    return {
      ...defaultPreferences,
      ...parsed,
      rule34Credentials: {
        ...defaultPreferences.rule34Credentials,
        ...(parsed.rule34Credentials ?? parsed.credentials),
      },
      excludeFilters: normalizeExcludeFilters(parsed.excludeFilters),
      defaultSource: parsed.defaultSource ?? 'rule34',
      searchSource: parsed.searchSource ?? parsed.defaultSource ?? 'rule34',
      realbooruProxyUrl: normalizeRealbooruProxyUrl(parsed.realbooruProxyUrl),
    }
  } catch {
    return defaultPreferences
  }
}

export function savePreferences(preferences: UserPreferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
}

export function loadFeedSignals() {
  const rawValue = localStorage.getItem(FEED_SIGNALS_KEY)
  if (!rawValue) {
    return {} satisfies FeedSignals
  }

  try {
    return JSON.parse(rawValue) as FeedSignals
  } catch {
    return {} satisfies FeedSignals
  }
}

export function saveFeedSignals(signals: FeedSignals) {
  localStorage.setItem(FEED_SIGNALS_KEY, JSON.stringify(signals))
}

async function putLibraryItem(storeName: PostStoreName, item: LocalLibraryItem) {
  const db = await getDb()
  await db.put(storeName, item)
}

export async function getLibraryItems(storeName: keyof typeof POST_STORES) {
  const db = await getDb()
  const records = (await db.getAll(POST_STORES[storeName])) as LocalLibraryItem[]
  return sortLibrary(records)
}

export async function getLibraryItemsPage(
  storeName: keyof typeof POST_STORES,
  options: {
    cursor?: LibraryCursor | null
    limit?: number
  } = {},
) {
  const { cursor = null, limit = 60 } = options
  const db = await getDb()
  const transaction = db.transaction(POST_STORES[storeName])
  const index = transaction.store.index(TIMESTAMP_INDEX)
  let recordCursor = cursor
    ? await index.openCursor(IDBKeyRange.upperBound(cursor, true), 'prev')
    : await index.openCursor(null, 'prev')
  const items: LocalLibraryItem[] = []

  while (recordCursor && items.length < limit) {
    items.push(recordCursor.value as LocalLibraryItem)
    recordCursor = await recordCursor.continue()
  }

  await transaction.done

  const lastItem = items.at(-1)
  return {
    items,
    nextCursor:
      recordCursor && lastItem
        ? ([lastItem.timestamp, lastItem.storageKey] satisfies LibraryCursor)
        : null,
  }
}

export async function saveItem(item: LocalLibraryItem) {
  await putLibraryItem('savedItems', item)
}

export async function unsaveItem(storageKey: string) {
  const db = await getDb()
  await db.delete('savedItems', storageKey)
}

export async function recordHistory(item: LocalLibraryItem) {
  await putLibraryItem('historyItems', item)
}

export async function recordDownloadItem(item: LocalLibraryItem) {
  await putLibraryItem('downloadItems', item)
}

export async function getSavedIds() {
  const db = await getDb()
  const ids = (await db.getAllKeys('savedItems')) as string[]
  return new Set(ids)
}

export async function getHiddenIds() {
  const db = await getDb()
  const ids = (await db.getAllKeys('hiddenItems')) as string[]
  return new Set(ids)
}

export async function hideItem(storageKey: string) {
  const db = await getDb()
  await db.put('hiddenItems', Date.now(), storageKey)
}

export async function getMutedTags() {
  const db = await getDb()
  const records = (await db.getAll('mutedTags')) as { tag: string }[]
  return new Set(records.map((record) => record.tag))
}

export async function toggleMutedTagRecord(tag: string) {
  const db = await getDb()
  const existing = await db.get('mutedTags', tag)

  if (existing) {
    await db.delete('mutedTags', tag)
    return false
  }

  await db.put('mutedTags', { tag, mutedAt: Date.now() })
  return true
}

export async function getLibraryCounts() {
  const db = await getDb()
  const [saved, downloads, history] = await Promise.all([
    db.count('savedItems'),
    db.count('downloadItems'),
    db.count('historyItems'),
  ])
  return { saved, downloads, history }
}

export async function clearAllLocalData() {
  const db = await getDb()
  const clearStores = [
    'savedItems',
    'downloadItems',
    'historyItems',
    'hiddenItems',
    'mutedTags',
    ...LEGACY_POST_STORES,
    'hidden',
  ].filter((storeName) => db.objectStoreNames.contains(storeName))

  await Promise.all(clearStores.map((storeName) => db.clear(storeName as PostStoreName)))
  localStorage.removeItem(PREFERENCES_KEY)
  localStorage.removeItem(FEED_SIGNALS_KEY)
  localStorage.removeItem('r34browser.installDismissed')
}
