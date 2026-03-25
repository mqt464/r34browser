import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { FeedGrid } from '../components/FeedGrid'
import { SearchComposer } from '../components/SearchComposer'
import { filterVisiblePosts, usePostFeed } from '../hooks/usePostFeed'
import { getEnabledExcludeTags } from '../lib/preferences'
import { useAppContext } from '../state/useAppContext'
import type { SearchNavigationState } from '../types'

function parseQuery(query: string) {
  const includeTags: string[] = []
  const excludeTags: string[] = []

  query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((token) => {
      if (token.startsWith('-')) {
        excludeTags.push(token.slice(1))
      } else {
        includeTags.push(token)
      }
    })

  return { includeTags, excludeTags }
}

function readPendingQuery(state: unknown) {
  if (!state || typeof state !== 'object') {
    return ''
  }

  const pendingQuery = (state as SearchNavigationState).pendingQuery
  return typeof pendingQuery === 'string' ? pendingQuery : ''
}

export function SearchPage({ active = true }: { active?: boolean }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryText = searchParams.get('q') ?? ''
  const pendingQuery = readPendingQuery(location.state).trim()
  const composerValue = pendingQuery || queryText
  const { preferences, hiddenIds, mutedTags } = useAppContext()
  const parsedQuery = useMemo(() => parseQuery(queryText), [queryText])
  const blockedTags = useMemo(
    () =>
      Array.from(
        new Set([
          ...getEnabledExcludeTags(preferences.excludeFilters),
          ...parsedQuery.excludeTags,
          ...mutedTags,
        ]),
      ).sort(),
    [mutedTags, parsedQuery.excludeTags, preferences.excludeFilters],
  )
  const searchQuery = useMemo(
    () => ({
      includeTags: parsedQuery.includeTags,
      excludeTags: blockedTags,
    }),
    [blockedTags, parsedQuery.includeTags],
  )

  const feed = usePostFeed({
    credentials: preferences.credentials,
    enabled:
      Boolean(preferences.credentials.userId && preferences.credentials.apiKey) &&
      (parsedQuery.includeTags.length > 0 || parsedQuery.excludeTags.length > 0),
    query: searchQuery,
  })

  const visiblePosts = useMemo(
    () => (active ? filterVisiblePosts(feed.posts, hiddenIds, new Set(blockedTags)) : []),
    [active, blockedTags, feed.posts, hiddenIds],
  )

  return (
    <div className="page app-feed-page">
      <section className="composer-strip">
        <SearchComposer
          credentials={preferences.credentials}
          hapticsEnabled={preferences.hapticsEnabled}
          initialValue={composerValue}
          key={composerValue || '__empty-search__'}
          onSubmit={(query) => {
            const trimmed = query.trim()
            if (!trimmed) {
              setSearchParams({})
            } else {
              setSearchParams({ q: trimmed })
            }
          }}
          submitting={feed.loading && feed.posts.length === 0}
        />
      </section>

      {!preferences.credentials.userId || !preferences.credentials.apiKey ? (
        <div aria-live="polite" className="status-banner error" role="status">
          Add your Rule34 credentials in Settings to load results.
        </div>
      ) : null}

      {feed.error ? (
        <div aria-live="polite" className="status-banner error" role="status">
          {feed.error}
        </div>
      ) : null}

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
