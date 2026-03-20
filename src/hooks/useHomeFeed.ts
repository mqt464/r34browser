import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildHomeFeedModel,
  fetchHomeFeedBatch,
  HOME_RECENT_ANCHOR_MEMORY,
  type HomeFeedModel,
} from '../lib/homeFeed'
import type { ApiCredentials, FeedItem, LocalLibraryItem } from '../types'

interface HomeFeedBatch {
  anchors: string[]
  hasMore: boolean
  nextPage: number
  posts: FeedItem[]
}

function mergeUniquePosts(current: FeedItem[], incoming: FeedItem[]) {
  const seen = new Set(current.map((post) => post.id))
  const merged = [...current]

  for (const post of incoming) {
    if (!seen.has(post.id)) {
      merged.push(post)
      seen.add(post.id)
    }
  }

  return merged
}

function filterExcludedPosts(posts: FeedItem[], excludedIds: Set<number>) {
  return posts.filter((post) => !excludedIds.has(post.id))
}

export function useHomeFeed(options: {
  blockedTags: string[]
  credentials: ApiCredentials
  enabled: boolean
  excludedPostIds: Set<number>
  savedPosts: LocalLibraryItem[]
}) {
  const { blockedTags, credentials, enabled, excludedPostIds, savedPosts } = options
  const [model, setModel] = useState<HomeFeedModel | null>(null)
  const [posts, setPosts] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [queuedBatch, setQueuedBatch] = useState<HomeFeedBatch | null>(null)
  const nextBatchPageRef = useRef(0)
  const requestTokenRef = useRef(0)
  const prefetchingRef = useRef(false)
  const recentAnchorsRef = useRef<string[]>([])
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const excludedPostIdsRef = useRef(excludedPostIds)
  const modelKey = useMemo(
    () =>
      JSON.stringify({
        blockedTags,
        savedPosts: savedPosts.map((post) => `${post.id}:${post.timestamp}`),
        userId: credentials.userId,
      }),
    [blockedTags, credentials.userId, savedPosts],
  )

  useEffect(() => {
    excludedPostIdsRef.current = excludedPostIds
  }, [excludedPostIds])

  useEffect(() => {
    requestTokenRef.current += 1
    setPosts([])
    setHasMore(true)
    setLoadingMore(false)
    setQueuedBatch(null)
    setError(null)
    nextBatchPageRef.current = 0
    prefetchingRef.current = false
    recentAnchorsRef.current = []
  }, [enabled, modelKey])

  useEffect(() => {
    if (!enabled || savedPosts.length === 0) {
      setModel(null)
      setPlanning(false)
      return
    }

    let cancelled = false
    setPlanning(true)
    setError(null)

    void buildHomeFeedModel({
      blockedTags,
      credentials,
      savedPosts,
    })
      .then((nextModel) => {
        if (!cancelled) {
          setModel(nextModel)
          setPlanning(false)
        }
      })
      .catch((caughtError) => {
        if (cancelled) {
          return
        }

        setModel(null)
        setPlanning(false)
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Could not build your home feed from saved posts.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [blockedTags, credentials, enabled, savedPosts])

  useEffect(() => {
    if (!enabled || !model) {
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const activeModel = model
    const token = requestTokenRef.current

    async function run() {
      setLoading(true)
      setLoadingMore(false)
      try {
        const initialBatch = await fetchHomeFeedBatch({
          credentials,
          excludedPostIds: excludedPostIdsRef.current,
          model: activeModel,
          page: nextBatchPageRef.current,
          recentAnchors: recentAnchorsRef.current,
        })

        if (token !== requestTokenRef.current) {
          return
        }

        nextBatchPageRef.current = initialBatch.nextPage
        recentAnchorsRef.current = initialBatch.anchors.slice(-HOME_RECENT_ANCHOR_MEMORY)
        setPosts(filterExcludedPosts(initialBatch.posts, excludedPostIdsRef.current))
        setHasMore(initialBatch.hasMore)
        setQueuedBatch(null)
        setError(null)
      } catch (caughtError) {
        if (token !== requestTokenRef.current) {
          return
        }

        setError(caughtError instanceof Error ? caughtError.message : 'Could not load posts.')
      } finally {
        if (token === requestTokenRef.current) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      requestTokenRef.current += 1
    }
  }, [credentials, enabled, model])

  useEffect(() => {
    if (
      !enabled ||
      !model ||
      loading ||
      queuedBatch ||
      !hasMore ||
      posts.length === 0 ||
      prefetchingRef.current
    ) {
      return
    }

    const activeModel = model
    const token = requestTokenRef.current
    prefetchingRef.current = true
    setLoadingMore(true)

    async function run() {
      try {
        const nextBatch = await fetchHomeFeedBatch({
          credentials,
          excludedPostIds: new Set([
            ...excludedPostIdsRef.current,
            ...posts.map((post) => post.id),
          ]),
          model: activeModel,
          page: nextBatchPageRef.current,
          recentAnchors: recentAnchorsRef.current,
        })

        if (token !== requestTokenRef.current) {
          return
        }

        nextBatchPageRef.current = nextBatch.nextPage
        recentAnchorsRef.current = [
          ...recentAnchorsRef.current,
          ...nextBatch.anchors,
        ].slice(-HOME_RECENT_ANCHOR_MEMORY)
        setQueuedBatch(nextBatch)
      } catch (caughtError) {
        if (token !== requestTokenRef.current) {
          return
        }

        setError(caughtError instanceof Error ? caughtError.message : 'Could not load posts.')
      } finally {
        if (token === requestTokenRef.current) {
          prefetchingRef.current = false
          setLoadingMore(false)
        }
      }
    }

    void run()
  }, [credentials, enabled, hasMore, loading, model, posts.length, queuedBatch])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !enabled || !model) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || loading || (!queuedBatch && !hasMore)) {
          return
        }

        if (!queuedBatch) {
          return
        }

        setPosts((current) =>
          mergeUniquePosts(
            current,
            filterExcludedPosts(
              queuedBatch.posts,
              new Set([...excludedPostIdsRef.current, ...current.map((post) => post.id)]),
            ),
          ),
        )
        setHasMore(queuedBatch.hasMore)
        setQueuedBatch(null)
      },
      { rootMargin: '220px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, hasMore, loading, model, queuedBatch])

  return {
    error,
    focusTags: model?.focusTags ?? [],
    loading,
    loadingMore,
    planning,
    posts,
    hasMore,
    sentinelRef,
  }
}
