import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { getPreloadImageUrl } from '../lib/media'
import { useAppContext } from '../state/useAppContext'
import { PostCard } from './PostCard'
import type { FeedItem } from '../types'

const EMPTY_POSTS: FeedItem[] = []
const LONG_POST_RATIO = 1.85
const TRUNCATED_POST_MAX_REM = 42
const TRUNCATED_POST_MAX_VH = 0.74
const MASONRY_GAP_REM = 0.38
const CARD_CHROME_HEIGHT = 0.34
const LOADING_MORE_SKELETON_HEIGHTS = ['14rem', '18rem', '22rem']

function getRootFontSize() {
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16
}

function getCollapsedLongPostRatio(columnWidth: number, viewportHeight: number, rootFontSize: number) {
  const maxCollapsedHeight = Math.min(
    TRUNCATED_POST_MAX_REM * rootFontSize,
    viewportHeight * TRUNCATED_POST_MAX_VH,
  )

  return maxCollapsedHeight / Math.max(columnWidth, 1)
}

function estimatePostHeight(
  post: FeedItem,
  columnWidth: number,
  viewportHeight: number,
  rootFontSize: number,
) {
  const width = post.sampleWidth || post.width || 1
  const height = post.sampleHeight || post.height || width
  const mediaRatio = height / width

  if (mediaRatio >= LONG_POST_RATIO) {
    return (
      Math.min(
        mediaRatio,
        getCollapsedLongPostRatio(columnWidth, viewportHeight, rootFontSize),
      ) + CARD_CHROME_HEIGHT
    )
  }

  return mediaRatio + CARD_CHROME_HEIGHT
}

function distributePosts(
  posts: FeedItem[],
  columns: number,
  gridWidth: number,
  viewportHeight: number,
  rootFontSize: number,
) {
  if (columns <= 1) {
    return [posts]
  }

  const totalGapWidth = Math.max(0, columns - 1) * MASONRY_GAP_REM * rootFontSize
  const columnWidth = Math.max((gridWidth - totalGapWidth) / columns, 1)
  const buckets = Array.from({ length: columns }, () => [] as FeedItem[])
  const heights = Array.from({ length: columns }, () => 0)

  for (const post of posts) {
    const shortestIndex = heights.indexOf(Math.min(...heights))
    buckets[shortestIndex].push(post)
    heights[shortestIndex] += estimatePostHeight(post, columnWidth, viewportHeight, rootFontSize)
  }

  return buckets
}

export function FeedGrid({
  active = true,
  posts,
  loading = false,
  loadingMore = false,
  hasMore = true,
  sentinelRef,
}: {
  active?: boolean
  posts: FeedItem[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  sentinelRef?: RefObject<HTMLDivElement | null>
}) {
  const { preferences } = useAppContext()
  const gridRef = useRef<HTMLElement | null>(null)
  const [gridWidth, setGridWidth] = useState(() => window.innerWidth)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [rootFontSize, setRootFontSize] = useState(() => getRootFontSize())
  const [postOverrides, setPostOverrides] = useState<Record<string, FeedItem>>({})
  const columns = Math.max(1, preferences.masonryColumns)
  const layoutPosts = active ? posts : EMPTY_POSTS
  const resolvedPosts = useMemo(
    () => layoutPosts.map((post) => postOverrides[post.storageKey] ?? post),
    [layoutPosts, postOverrides],
  )

  useEffect(() => {
    if (!active) {
      return
    }

    const onResize = () => {
      setViewportHeight(window.innerHeight)
      setRootFontSize(getRootFontSize())
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active])

  useEffect(() => {
    if (!active) {
      return
    }

    const element = gridRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    setGridWidth(element.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries
      if (entry) {
        setGridWidth(entry.contentRect.width)
      }
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [active, columns, posts.length])

  const distributedPosts = useMemo(
    () => distributePosts(resolvedPosts, columns, gridWidth, viewportHeight, rootFontSize),
    [columns, gridWidth, resolvedPosts, rootFontSize, viewportHeight],
  )
  const viewerIndexByPostId = useMemo(() => {
    const next = new Map<string, number>()
    resolvedPosts.forEach((post, index) => {
      next.set(post.storageKey, index)
    })
    return next
  }, [resolvedPosts])

  useEffect(() => {
    if (!active) {
      return
    }

    resolvedPosts.slice(0, 8).forEach((post) => {
      const preloadUrl = getPreloadImageUrl(post)

      if (!preloadUrl) {
        return
      }

      const img = new Image()
      img.src = preloadUrl
    })
  }, [active, resolvedPosts])

  if (!active) {
    return null
  }

  if (loading && posts.length === 0) {
    return (
      <section
        className={`feed-grid columns-${columns}`}
        ref={gridRef}
        style={{ ['--masonry-columns' as string]: String(columns) }}
      >
        {Array.from({ length: columns }).map((_, columnIndex) => (
          <div className="masonry-column" key={`skeleton-column-${columnIndex}`}>
            {Array.from({ length: 3 }).map((__, itemIndex) => (
              <div className="feed-skeleton" key={`skeleton-${columnIndex}-${itemIndex}`} />
            ))}
          </div>
        ))}
      </section>
    )
  }

  if (posts.length === 0) {
    return sentinelRef ? <div className="sentinel" ref={sentinelRef} /> : null
  }

  return (
    <>
      <section
        className={`feed-grid columns-${columns}`}
        ref={gridRef}
        style={{ ['--masonry-columns' as string]: String(columns) }}
      >
        {distributedPosts.map((columnPosts, index) => (
          <div className="masonry-column" key={`column-${index}`}>
            {columnPosts.map((post) => (
              <PostCard
                key={post.storageKey}
                onEnriched={(nextPost) =>
                  setPostOverrides((current) => ({
                    ...current,
                    [nextPost.storageKey]: nextPost,
                  }))
                }
                post={post}
                viewerIndex={viewerIndexByPostId.get(post.storageKey) ?? 0}
                viewerPosts={resolvedPosts}
              />
            ))}
            {loadingMore ? (
              <div
                aria-hidden="true"
                className="feed-skeleton feed-skeleton-inline"
                style={
                  {
                    ['--feed-skeleton-height' as string]:
                      LOADING_MORE_SKELETON_HEIGHTS[index % LOADING_MORE_SKELETON_HEIGHTS.length],
                  }
                }
              />
            ) : null}
          </div>
        ))}
      </section>
      {!loadingMore && !hasMore ? (
        <div aria-live="polite" className="feed-list-status" role="status">
          You have reached the end of the feed.
        </div>
      ) : null}
      {loadingMore ? <div aria-live="polite" className="sr-only" role="status">Loading more posts.</div> : null}
      {sentinelRef && hasMore ? <div className="sentinel" ref={sentinelRef} /> : null}
    </>
  )
}
