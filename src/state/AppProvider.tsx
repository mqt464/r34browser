import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { AppContext } from './AppContextObject'
import type { FeedItem, FeedSignals, PreferenceUpdates, UserPreferences } from '../types'
import {
  getHiddenIds,
  getMutedTags,
  getSavedIds,
  hideItem,
  loadFeedSignals,
  loadPreferences,
  recordDownloadItem,
  recordHistory,
  saveFeedSignals,
  saveItem,
  savePreferences,
  toggleMutedTagRecord,
  unsaveItem,
} from '../lib/storage'

function toLibraryItem(post: FeedItem, kind: 'saved' | 'history' | 'downloaded') {
  return {
    ...post,
    kind,
    timestamp: Date.now(),
  }
}

function applySignals(currentSignals: FeedSignals, tags: string[], weight: number) {
  const nextSignals = { ...currentSignals }
  for (const tag of tags) {
    nextSignals[tag] = (nextSignals[tag] ?? 0) + weight
  }
  return nextSignals
}

export function AppProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences())
  const [feedSignals, setFeedSignals] = useState<FeedSignals>(() => loadFeedSignals())
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [mutedTags, setMutedTags] = useState<Set<string>>(new Set())
  const [libraryVersion, setLibraryVersion] = useState(0)

  useEffect(() => {
    void Promise.all([getSavedIds(), getHiddenIds(), getMutedTags()]).then(
      ([saved, hidden, muted]) => {
        startTransition(() => {
          setSavedIds(saved)
          setHiddenIds(hidden)
          setMutedTags(muted)
        })
      },
    )
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', preferences.accentColor)
    document.documentElement.style.setProperty(
      '--accent-soft',
      `${preferences.accentColor}22`,
    )
  }, [preferences.accentColor])

  const updatePreferences = useCallback((updates: PreferenceUpdates) => {
    setPreferences((current) => {
      const next = {
        ...current,
        ...updates,
        credentials: {
          ...current.credentials,
          ...updates.credentials,
        },
        excludeFilters: {
          ...current.excludeFilters,
          ...updates.excludeFilters,
        },
      }
      savePreferences(next)
      return next
    })
  }, [])

  const bumpSignals = useCallback((tags: string[], weight: number) => {
    setFeedSignals((current) => {
      const next = applySignals(current, tags, weight)
      saveFeedSignals(next)
      return next
    })
  }, [])

  const savePost = useCallback(
    async (post: FeedItem) => {
      await saveItem(toLibraryItem(post, 'saved'))
      bumpSignals(post.tags, 3)
      setSavedIds((current) => new Set(current).add(post.id))
      setLibraryVersion((current) => current + 1)
    },
    [bumpSignals],
  )

  const unsavePost = useCallback(async (postId: number) => {
    await unsaveItem(postId)
    setSavedIds((current) => {
      const next = new Set(current)
      next.delete(postId)
      return next
    })
    setLibraryVersion((current) => current + 1)
  }, [])

  const hidePost = useCallback(async (post: FeedItem) => {
    await hideItem(post.id)
    setHiddenIds((current) => new Set(current).add(post.id))
    setLibraryVersion((current) => current + 1)
  }, [])

  const recordViewedPost = useCallback(
    async (post: FeedItem) => {
      await recordHistory(toLibraryItem(post, 'history'))
      bumpSignals(post.tags, 1)
      setLibraryVersion((current) => current + 1)
    },
    [bumpSignals],
  )

  const recordDownload = useCallback(
    async (post: FeedItem) => {
      await recordDownloadItem(toLibraryItem(post, 'downloaded'))
      bumpSignals(post.tags, 2)
      setLibraryVersion((current) => current + 1)
    },
    [bumpSignals],
  )

  const toggleMutedTag = useCallback(async (tag: string) => {
    const muted = await toggleMutedTagRecord(tag)
    setMutedTags((current) => {
      const next = new Set(current)
      if (muted) {
        next.add(tag)
      } else {
        next.delete(tag)
      }
      return next
    })
  }, [])

  const contextValue = useMemo(
    () => ({
      preferences,
      updatePreferences,
      savedIds,
      hiddenIds,
      mutedTags,
      feedSignals,
      libraryVersion,
      savePost,
      unsavePost,
      hidePost,
      recordViewedPost,
      recordDownload,
      toggleMutedTag,
    }),
    [
      feedSignals,
      hiddenIds,
      libraryVersion,
      mutedTags,
      preferences,
      recordDownload,
      recordViewedPost,
      savePost,
      savedIds,
      toggleMutedTag,
      unsavePost,
      updatePreferences,
      hidePost,
    ],
  )

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
}
