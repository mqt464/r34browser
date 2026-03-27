import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeedGrid } from '../components/FeedGrid'
import { getLibraryItemsPage, type LibraryCursor } from '../lib/storage'
import { useAppContext } from '../state/useAppContext'
import type { LocalLibraryItem } from '../types'

const PAGE_SIZE = 60

export function SavedPage({ active = true }: { active?: boolean }) {
  const { libraryVersion, hiddenIds, mutedTags } = useAppContext()
  const [items, setItems] = useState<LocalLibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<LibraryCursor | null>(null)
  const loadingRef = useRef(false)
  const requestTokenRef = useRef(0)

  const loadItems = useCallback(async (reset: boolean) => {
    if (loadingRef.current) {
      return
    }

    loadingRef.current = true
    requestTokenRef.current += 1
    const token = requestTokenRef.current

    if (reset) {
      cursorRef.current = null
      setLoading(true)
      setLoadingMore(false)
    } else {
      setLoadingMore(true)
    }

    try {
      const page = await getLibraryItemsPage('saved', {
        cursor: reset ? null : cursorRef.current,
        limit: PAGE_SIZE,
      })

      if (token !== requestTokenRef.current) {
        return
      }

      cursorRef.current = page.nextCursor
      setItems((current) => (reset ? page.items : [...current, ...page.items]))
      setHasMore(Boolean(page.nextCursor))
    } finally {
      if (token === requestTokenRef.current) {
        loadingRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    cursorRef.current = null
    setItems([])
    setHasMore(true)
    loadingRef.current = false
    requestTokenRef.current += 1
  }, [libraryVersion])

  useEffect(() => {
    if (!active || items.length > 0 || loadingRef.current || !hasMore) {
      return
    }

    void loadItems(true)
  }, [active, hasMore, items.length, loadItems])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !active || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || loadingRef.current || !cursorRef.current) {
          return
        }

        void loadItems(false)
      },
      { rootMargin: '260px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [active, hasMore, items.length, loadItems])

  const visibleItems = useMemo(
    () =>
      active
        ? items.filter(
            (item) =>
              !hiddenIds.has(item.storageKey) && !item.tags.some((tag) => mutedTags.has(tag)),
          )
        : [],
    [active, hiddenIds, items, mutedTags],
  )

  return (
    <div className="page app-feed-page">
      {items.length > 0 || loading || loadingMore ? (
        <FeedGrid
          active={active}
          hasMore={hasMore}
          loading={loading}
          loadingMore={loadingMore}
          posts={visibleItems}
          sentinelRef={sentinelRef}
        />
      ) : (
        <section className="empty-state">
          <strong>No favourites yet</strong>
          <span className="muted">Save posts from the feed and they will appear here.</span>
        </section>
      )}
    </div>
  )
}
