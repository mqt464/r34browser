import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPosts } from '../lib/api'
import type { ApiCredentials, FeedItem, SearchQuery } from '../types'

const PAGE_SIZE = 24

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

export function filterVisiblePosts(
  posts: FeedItem[],
  hiddenIds: Set<number>,
  mutedTags: Set<string>,
) {
  return posts.filter((post) => {
    if (hiddenIds.has(post.id)) {
      return false
    }

    return !post.tags.some((tag) => mutedTags.has(tag))
  })
}

export function usePostFeed(options: {
  credentials: ApiCredentials
  query: SearchQuery
  enabled: boolean
}) {
  const { credentials, query, enabled } = options
  const [posts, setPosts] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)
  const requestTokenRef = useRef(0)

  const queryKey = JSON.stringify({
    userId: credentials.userId,
    apiKey: credentials.apiKey,
    includeTags: query.includeTags,
    excludeTags: query.excludeTags,
  })
  const request = useMemo(
    () => ({
      credentials: {
        userId: credentials.userId,
        apiKey: credentials.apiKey,
      },
      query: {
        includeTags: query.includeTags,
        excludeTags: query.excludeTags,
      },
    }),
    [credentials.apiKey, credentials.userId, query],
  )

  useEffect(() => {
    requestTokenRef.current += 1
    loadingRef.current = false
    hasMoreRef.current = true
    setPosts([])
    setPage(0)
    setHasMore(true)
    setLoadingMore(false)
    setError(null)
  }, [queryKey, enabled])

  useEffect(() => {
    if (!enabled) {
      loadingRef.current = false
      setLoading(false)
      setLoadingMore(false)
      return
    }

    let cancelled = false
    const token = requestTokenRef.current

    async function run() {
      loadingRef.current = true
      setLoading(true)
      setLoadingMore(page > 0)
      try {
        const nextPosts = await fetchPosts({
          credentials: request.credentials,
          page,
          limit: PAGE_SIZE,
          query: request.query,
        })

        if (cancelled || token !== requestTokenRef.current) {
          return
        }

        setPosts((current) => (page === 0 ? nextPosts : mergeUniquePosts(current, nextPosts)))
        const nextHasMore = nextPosts.length === PAGE_SIZE
        hasMoreRef.current = nextHasMore
        setHasMore(nextHasMore)
        setError(null)
      } catch (caughtError) {
        if (cancelled || token !== requestTokenRef.current) {
          return
        }
        setError(caughtError instanceof Error ? caughtError.message : 'Could not load posts.')
      } finally {
        if (!cancelled && token === requestTokenRef.current) {
          loadingRef.current = false
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [enabled, page, request])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !enabled) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || loadingRef.current || !hasMoreRef.current) {
          return
        }

        loadingRef.current = true
        setPage((current) => current + 1)
      },
      { rootMargin: '220px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, loading, posts.length, queryKey])

  return {
    posts,
    loading,
    loadingMore,
    error,
    hasMore,
    sentinelRef,
  }
}
