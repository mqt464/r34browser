import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildHomeFeedModel,
  fetchHomeFeedBatch,
  HOME_RECENT_ANCHOR_MEMORY,
  type HomeFeedModel,
} from '../lib/homeFeed'
import type { ApiCredentials, FeedItem, LocalLibraryItem, SourceId } from '../types'

type SourceBatchState = {
  hasMore: boolean
  model: HomeFeedModel | null
  nextPage: number
  partialError: string | null
  planning: boolean
  recentAnchors: string[]
  source: SourceId
}

function mergeUniquePosts(current: FeedItem[], incoming: FeedItem[]) {
  const seen = new Set(current.map((post) => post.storageKey))
  const merged = [...current]

  for (const post of incoming) {
    if (!seen.has(post.storageKey)) {
      merged.push(post)
      seen.add(post.storageKey)
    }
  }

  return merged
}

function filterExcludedPosts(posts: FeedItem[], excludedIds: Set<string>) {
  return posts.filter((post) => !excludedIds.has(post.storageKey))
}

const SOURCE_ORDER: SourceId[] = ['rule34', 'realbooru']

export function useHomeFeed(options: {
  blockedTags: string[]
  excludedPostIds: Set<string>
  rule34Credentials?: ApiCredentials
  savedPosts: LocalLibraryItem[]
}) {
  const { blockedTags, excludedPostIds, rule34Credentials, savedPosts } = options
  const [posts, setPosts] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const requestTokenRef = useRef(0)
  const excludedPostIdsRef = useRef(excludedPostIds)
  const statesRef = useRef<Record<SourceId, SourceBatchState>>({
    rule34: {
      hasMore: true,
      model: null,
      nextPage: 0,
      partialError: null,
      planning: false,
      recentAnchors: [],
      source: 'rule34',
    },
    realbooru: {
      hasMore: true,
      model: null,
      nextPage: 0,
      partialError: null,
      planning: false,
      recentAnchors: [],
      source: 'realbooru',
    },
  })

  const savedPostsBySource = useMemo(
    () => ({
      rule34: savedPosts.filter((post) => post.source === 'rule34'),
      realbooru: savedPosts.filter((post) => post.source === 'realbooru'),
    }),
    [savedPosts],
  )
  const modelKey = useMemo(
    () =>
      JSON.stringify({
        blockedTags,
        savedPosts: savedPosts.map((post) => `${post.storageKey}:${post.timestamp}`),
        rule34UserId: rule34Credentials?.userId ?? '',
      }),
    [blockedTags, rule34Credentials?.userId, savedPosts],
  )

  useEffect(() => {
    excludedPostIdsRef.current = excludedPostIds
  }, [excludedPostIds])

  useEffect(() => {
    requestTokenRef.current += 1
    setPosts([])
    setHasMore(true)
    setLoadingMore(false)
    setError(null)
    setPartialErrors([])
    statesRef.current = {
      rule34: {
        hasMore: true,
        model: null,
        nextPage: 0,
        partialError: null,
        planning: false,
        recentAnchors: [],
        source: 'rule34',
      },
      realbooru: {
        hasMore: true,
        model: null,
        nextPage: 0,
        partialError: null,
        planning: false,
        recentAnchors: [],
        source: 'realbooru',
      },
    }
  }, [modelKey])

  useEffect(() => {
    let cancelled = false
    setPlanning(true)

    async function run() {
      const nextStates = { ...statesRef.current }
      const errors: string[] = []

      await Promise.all(
        SOURCE_ORDER.map(async (source) => {
          const sourceSavedPosts = savedPostsBySource[source]
          if (sourceSavedPosts.length === 0) {
            nextStates[source] = {
              ...nextStates[source],
              hasMore: false,
              model: null,
              partialError: null,
              planning: false,
            }
            return
          }

          if (source === 'rule34' && (!rule34Credentials?.userId || !rule34Credentials?.apiKey)) {
            nextStates[source] = {
              ...nextStates[source],
              hasMore: false,
              model: null,
              partialError: 'Rule34 home pool unavailable: missing credentials.',
              planning: false,
            }
            errors.push('Rule34 home pool unavailable: missing credentials.')
            return
          }

          nextStates[source] = { ...nextStates[source], planning: true }

          try {
            const model = await buildHomeFeedModel({
              blockedTags,
              credentials: source === 'rule34' ? rule34Credentials : undefined,
              savedPosts: sourceSavedPosts,
              source,
            })

            nextStates[source] = {
              ...nextStates[source],
              hasMore: true,
              model,
              partialError: null,
              planning: false,
            }
          } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : 'Unknown error'
            nextStates[source] = {
              ...nextStates[source],
              hasMore: false,
              model: null,
              partialError: `${source === 'rule34' ? 'Rule34' : 'Realbooru'} home pool failed: ${message}`,
              planning: false,
            }
            errors.push(nextStates[source].partialError!)
          }
        }),
      )

      if (cancelled) {
        return
      }

      statesRef.current = nextStates
      setPlanning(false)
      setPartialErrors(errors)

      if (!nextStates.rule34.model && !nextStates.realbooru.model) {
        setError(errors[0] ?? 'Could not build the home feed.')
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [blockedTags, rule34Credentials, savedPostsBySource])

  useEffect(() => {
    if (planning) {
      return
    }

    const activeStates = SOURCE_ORDER.filter((source) => Boolean(statesRef.current[source].model))
    if (activeStates.length === 0) {
      setLoading(false)
      setLoadingMore(false)
      return
    }

    let cancelled = false
    const token = requestTokenRef.current

    async function loadBatch() {
      setLoading(true)

      try {
        const batches = await Promise.all(
          SOURCE_ORDER.map(async (source) => {
            const state = statesRef.current[source]
            if (!state.model || !state.hasMore) {
              return { hasMore: false, partialError: state.partialError, posts: [] as FeedItem[], source }
            }

            try {
              const batch = await fetchHomeFeedBatch({
                credentials: source === 'rule34' ? rule34Credentials : undefined,
                excludedPostIds: excludedPostIdsRef.current,
                model: state.model,
                page: state.nextPage,
                recentAnchors: state.recentAnchors,
                source,
              })

              statesRef.current[source] = {
                ...state,
                hasMore: batch.hasMore,
                nextPage: batch.nextPage,
                recentAnchors: batch.anchors.slice(-HOME_RECENT_ANCHOR_MEMORY),
              }

              return {
                hasMore: batch.hasMore,
                partialError: null,
                posts: batch.posts,
                source,
              }
            } catch (caughtError) {
              const message = caughtError instanceof Error ? caughtError.message : 'Unknown error'
              statesRef.current[source] = {
                ...state,
                hasMore: false,
                partialError: `${source === 'rule34' ? 'Rule34' : 'Realbooru'} home pool failed: ${message}`,
              }

              return {
                hasMore: false,
                partialError: statesRef.current[source].partialError,
                posts: [] as FeedItem[],
                source,
              }
            }
          }),
        )

        if (cancelled || token !== requestTokenRef.current) {
          return
        }

        const nextPosts = batches.flatMap((batch) => batch.posts)
        const nextErrors = batches.flatMap((batch) => (batch.partialError ? [batch.partialError] : []))
        setPosts(filterExcludedPosts(nextPosts, excludedPostIdsRef.current))
        setHasMore(batches.some((batch) => batch.hasMore))
        setPartialErrors(nextErrors)
        setError(nextPosts.length === 0 && nextErrors.length > 0 ? nextErrors[0] : null)
      } finally {
        if (!cancelled && token === requestTokenRef.current) {
          setLoading(false)
        }
      }
    }

    void loadBatch()

    return () => {
      cancelled = true
    }
  }, [planning, rule34Credentials])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || posts.length === 0 || loading || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || loadingMore || !hasMore) {
          return
        }

        setLoadingMore(true)
        const token = requestTokenRef.current

        void Promise.all(
          SOURCE_ORDER.map(async (source) => {
            const state = statesRef.current[source]
            if (!state.model || !state.hasMore) {
              return { partialError: state.partialError, posts: [] as FeedItem[], source }
            }

            try {
              const batch = await fetchHomeFeedBatch({
                credentials: source === 'rule34' ? rule34Credentials : undefined,
                excludedPostIds: new Set([
                  ...excludedPostIdsRef.current,
                  ...posts.map((post) => post.storageKey),
                ]),
                model: state.model,
                page: state.nextPage,
                recentAnchors: state.recentAnchors,
                source,
              })

              statesRef.current[source] = {
                ...state,
                hasMore: batch.hasMore,
                nextPage: batch.nextPage,
                recentAnchors: [...state.recentAnchors, ...batch.anchors].slice(-HOME_RECENT_ANCHOR_MEMORY),
              }

              return { partialError: null, posts: batch.posts, source }
            } catch (caughtError) {
              const message = caughtError instanceof Error ? caughtError.message : 'Unknown error'
              statesRef.current[source] = {
                ...state,
                hasMore: false,
                partialError: `${source === 'rule34' ? 'Rule34' : 'Realbooru'} home pool failed: ${message}`,
              }
              return { partialError: statesRef.current[source].partialError, posts: [] as FeedItem[], source }
            }
          }),
        ).then((batches) => {
          if (token !== requestTokenRef.current) {
            return
          }

          const nextPosts = filterExcludedPosts(batches.flatMap((batch) => batch.posts), new Set([
            ...excludedPostIdsRef.current,
            ...posts.map((post) => post.storageKey),
          ]))
          const nextErrors = batches.flatMap((batch) => (batch.partialError ? [batch.partialError] : []))
          setPosts((current) => mergeUniquePosts(current, nextPosts))
          setHasMore(SOURCE_ORDER.some((source) => statesRef.current[source].hasMore))
          setPartialErrors(nextErrors)
          setLoadingMore(false)
        }).catch(() => {
          if (token === requestTokenRef.current) {
            setLoadingMore(false)
          }
        })
      },
      { rootMargin: '220px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, posts, rule34Credentials])

  return {
    error,
    hasMore,
    loading,
    loadingMore,
    partialErrors,
    planning,
    posts,
    sentinelRef,
  }
}
