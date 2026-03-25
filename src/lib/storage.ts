import { openDB } from 'idb'
import { DEFAULT_EXCLUDE_FILTERS, normalizeExcludeFilters } from './preferences'
import type { FeedSignals, LocalLibraryItem, UserPreferences } from '../types'

const DB_NAME = 'r34browser'
const DB_VERSION = 2
const PREFERENCES_KEY = 'r34browser.preferences'
const FEED_SIGNALS_KEY = 'r34browser.feedSignals'
const TIMESTAMP_INDEX = 'by-timestamp'

type PostStoreName = 'saved' | 'history' | 'downloads'
export type LibraryCursor = [number, number]

const defaultPreferences: UserPreferences = {
  credentials: {
    userId: '',
    apiKey: '',
  },
  excludeFilters: DEFAULT_EXCLUDE_FILTERS,
  masonryColumns: 1,
  hapticsEnabled: true,
  autoplayEnabled: false,
  preferShareOnMobile: true,
  accentColor: '#4f8cff',
}

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      const ensurePostStore = (storeName: PostStoreName) => {
        const store = database.objectStoreNames.contains(storeName)
          ? transaction.objectStore(storeName)
          : database.createObjectStore(storeName, { keyPath: 'id' })

        if (!store.indexNames.contains(TIMESTAMP_INDEX)) {
          store.createIndex(TIMESTAMP_INDEX, ['timestamp', 'id'])
        }
      }

      ensurePostStore('saved')
      ensurePostStore('history')
      ensurePostStore('downloads')

      if (!database.objectStoreNames.contains('hidden')) {
        database.createObjectStore('hidden')
      }
      if (!database.objectStoreNames.contains('mutedTags')) {
        database.createObjectStore('mutedTags', { keyPath: 'tag' })
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
    const parsed = JSON.parse(rawValue) as Partial<UserPreferences>
    return {
      ...defaultPreferences,
      ...parsed,
      credentials: {
        ...defaultPreferences.credentials,
        ...parsed.credentials,
      },
      excludeFilters: normalizeExcludeFilters(parsed.excludeFilters),
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

export async function getLibraryItems(storeName: PostStoreName) {
  const db = await getDb()
  const records = (await db.getAll(storeName)) as LocalLibraryItem[]
  return sortLibrary(records)
}

export async function getLibraryItemsPage(
  storeName: PostStoreName,
  options: {
    cursor?: LibraryCursor | null
    limit?: number
  } = {},
) {
  const { cursor = null, limit = 60 } = options
  const db = await getDb()
  const transaction = db.transaction(storeName)
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
      recordCursor && lastItem ? ([lastItem.timestamp, lastItem.id] satisfies LibraryCursor) : null,
  }
}

export async function saveItem(item: LocalLibraryItem) {
  await putLibraryItem('saved', item)
}

export async function unsaveItem(postId: number) {
  const db = await getDb()
  await db.delete('saved', postId)
}

export async function recordHistory(item: LocalLibraryItem) {
  await putLibraryItem('history', item)
}

export async function recordDownloadItem(item: LocalLibraryItem) {
  await putLibraryItem('downloads', item)
}

export async function getSavedIds() {
  const db = await getDb()
  const ids = (await db.getAllKeys('saved')) as number[]
  return new Set(ids)
}

export async function getHiddenIds() {
  const db = await getDb()
  const ids = (await db.getAllKeys('hidden')) as number[]
  return new Set(ids)
}

export async function hideItem(postId: number) {
  const db = await getDb()
  await db.put('hidden', Date.now(), postId)
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
    db.count('saved'),
    db.count('downloads'),
    db.count('history'),
  ])
  return { saved, downloads, history }
}

export async function clearAllLocalData() {
  const db = await getDb()
  await Promise.all([
    db.clear('saved'),
    db.clear('downloads'),
    db.clear('history'),
    db.clear('hidden'),
    db.clear('mutedTags'),
  ])
  localStorage.removeItem(PREFERENCES_KEY)
  localStorage.removeItem(FEED_SIGNALS_KEY)
  localStorage.removeItem('r34browser.installDismissed')
}
