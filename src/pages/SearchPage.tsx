import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { FeedGrid } from '../components/FeedGrid'
import { SearchComposer } from '../components/SearchComposer'
import { filterVisiblePosts, usePostFeed } from '../hooks/usePostFeed'
import { getCredentialsForSource, hasRequiredCredentials } from '../lib/providerPreferences'
import { getEnabledExcludeTags } from '../lib/preferences'
import { useAppContext } from '../state/useAppContext'
import { getSourceLabel } from '../lib/sources'
import type { SearchNavigationState, SourceId } from '../types'

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
  const sourceParam = searchParams.get('source')
  const pendingQuery = readPendingQuery(location.state).trim()
  const pendingSource = typeof (location.state as SearchNavigationState | null)?.pendingSource === 'string'
    ? (location.state as SearchNavigationState).pendingSource
    : undefined
  const composerValue = pendingQuery || queryText
  const { preferences, hiddenIds, mutedTags, updatePreferences } = useAppContext()
  const searchSource = (pendingSource ?? sourceParam ?? preferences.searchSource ?? 'rule34') as SourceId
  const credentials = getCredentialsForSource(preferences, searchSource)
  const hasAccess = hasRequiredCredentials(preferences, searchSource)
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
    source: searchSource,
    credentials,
    enabled:
      hasAccess &&
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
          credentials={credentials}
          hapticsEnabled={preferences.hapticsEnabled}
          initialValue={composerValue}
          key={composerValue || '__empty-search__'}
          onSourceChange={(source) => {
            updatePreferences({ searchSource: source })
            const next = new URLSearchParams(searchParams)
            next.set('source', source)
            setSearchParams(next)
          }}
          onSubmit={(query) => {
            const trimmed = query.trim()
            const next = new URLSearchParams()
            next.set('source', searchSource)
            if (!trimmed) {
              setSearchParams(next)
            } else {
              next.set('q', trimmed)
              setSearchParams(next)
            }
          }}
          source={searchSource}
          submitting={feed.loading && feed.posts.length === 0}
        />
      </section>

      {!hasAccess ? (
        <div aria-live="polite" className="status-banner error" role="status">
          Add your {getSourceLabel(searchSource)} credentials in Settings to load results.
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
