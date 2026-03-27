import { useEffect, useMemo, useState } from 'react'
import { FeedGrid } from '../components/FeedGrid'
import { useHomeFeed } from '../hooks/useHomeFeed'
import { filterVisiblePosts } from '../hooks/usePostFeed'
import { getCredentialsForSource } from '../lib/providerPreferences'
import { getEnabledExcludeTags } from '../lib/preferences'
import { getLibraryItems } from '../lib/storage'
import { useAppContext } from '../state/useAppContext'
import type { LocalLibraryItem } from '../types'

export function HomePage({ active = true }: { active?: boolean }) {
  const { preferences, hiddenIds, libraryVersion, mutedTags, savedIds } = useAppContext()
  const [savedPosts, setSavedPosts] = useState<LocalLibraryItem[]>([])
  const rule34Credentials = getCredentialsForSource(preferences, 'rule34')
  const hasRule34Credentials = Boolean(rule34Credentials?.userId && rule34Credentials.apiKey)
  const blockedTags = useMemo(
    () =>
      Array.from(
        new Set([...getEnabledExcludeTags(preferences.excludeFilters), ...mutedTags]),
      ).sort(),
    [mutedTags, preferences.excludeFilters],
  )

  useEffect(() => {
    let cancelled = false

    void getLibraryItems('saved').then((items) => {
      if (!cancelled) {
        // Keep the active home feed stable after it has been seeded once.
        setSavedPosts((current) => (current.length === 0 ? items : current))
      }
    })

    return () => {
      cancelled = true
    }
  }, [libraryVersion])

  const feed = useHomeFeed({
    blockedTags,
    excludedPostIds: savedIds,
    rule34Credentials,
    savedPosts,
  })

  const visiblePosts = useMemo(
    () => (active ? filterVisiblePosts(feed.posts, hiddenIds, new Set(blockedTags)) : []),
    [active, blockedTags, feed.posts, hiddenIds],
  )
  const showHomeFeedLoading = feed.loading && feed.posts.length === 0 && !feed.planning && !feed.error

  return (
    <div className="page app-feed-page">
      {!hasRule34Credentials ? (
        <section aria-live="polite" className="status-banner error" role="status">
          Add your <span className="mono">user_id</span> and <span className="mono">api_key</span> in Settings to keep the Rule34 pool active.
        </section>
      ) : null}

      {feed.planning && savedPosts.length > 0 ? (
        <section aria-live="polite" className="feed-list-status is-loading" role="status">
          <span aria-hidden="true" className="feed-list-status-spinner" />
          Building home recommendations from your saved posts.
        </section>
      ) : null}

      {showHomeFeedLoading ? (
        <section aria-live="polite" className="feed-list-status is-loading" role="status">
          <span aria-hidden="true" className="feed-list-status-spinner" />
          Loading posts...
        </section>
      ) : null}

      {feed.error ? (
        <section aria-live="polite" className="status-banner error" role="status">
          {feed.error}
        </section>
      ) : null}

      {feed.partialErrors
        .filter((message) => hasRule34Credentials || !message.includes('missing credentials'))
        .map((message) => (
        <section aria-live="polite" className="status-banner error" key={message} role="status">
          {message}
        </section>
        ))}

      <FeedGrid
        active={active}
        hasMore={feed.hasMore}
        loading={feed.loading}
        loadingMore={feed.loadingMore}
        posts={visiblePosts}
        sentinelRef={feed.sentinelRef}
      />
    </div>
  )
}
