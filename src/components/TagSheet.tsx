import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useScrollLock } from '../hooks/useScrollLock'
import { fetchTagMeta } from '../lib/api'
import { getCredentialsForSource } from '../lib/providerPreferences'
import { getTagTypeDetails, sortTagsByCategory } from '../lib/tagMeta'
import { useAppContext } from '../state/useAppContext'
import type { SearchNavigationState, SourceId, TagMeta } from '../types'

function splitQueryTokens(query: string) {
  return query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function readPendingQuery(state: unknown) {
  if (!state || typeof state !== 'object') {
    return ''
  }

  const pendingQuery = (state as SearchNavigationState).pendingQuery
  return typeof pendingQuery === 'string' ? pendingQuery : ''
}

export function TagSheet({
  open,
  onClose,
  source,
  tags,
}: {
  open: boolean
  onClose: () => void
  source: SourceId
  tags: string[]
}) {
  const { preferences } = useAppContext()
  const location = useLocation()
  const navigate = useNavigate()
  const [meta, setMeta] = useState<Map<string, TagMeta>>(new Map())
  const listRef = useRef<HTMLDivElement | null>(null)
  const credentials = getCredentialsForSource(preferences, source)

  useScrollLock(open, { allowScrollRef: listRef })

  const handleTagClick = (tag: string) => {
    const pendingQuery = readPendingQuery(location.state)
    const committedQuery = new URLSearchParams(location.search).get('q') ?? ''
    const queryTokens = splitQueryTokens(pendingQuery || committedQuery)

    if (!queryTokens.includes(tag)) {
      queryTokens.push(tag)
    }

    navigate({
      pathname: '/search',
      search: location.pathname === '/search' ? location.search : '',
    }, {
      state: {
        pendingQuery: queryTokens.join(' '),
        pendingSource: source,
      } satisfies SearchNavigationState,
    })
    onClose()
  }

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    void fetchTagMeta({ source, credentials, tags }).then((next) => {
      if (!cancelled) {
        setMeta(next)
      }
    }).catch(() => {
      if (!cancelled) {
        setMeta(new Map())
      }
    })

    return () => {
      cancelled = true
    }
  }, [credentials, open, source, tags])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const sortedTags = sortTagsByCategory(tags, meta)

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <section className="tag-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="tag-sheet-header">
          <strong>Tags</strong>
          <button className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="tag-sheet-list" ref={listRef}>
          {sortedTags.map((tag) => {
            const item = meta.get(tag)
            const details = getTagTypeDetails(item?.type ?? 0)
            const count = item?.count ? item.count.toLocaleString() : '0'

            return (
              <div className="tag-sheet-chip-wrap" key={tag}>
                <button
                  className={`tag-chip tag-chip-inline tag-sheet-chip tag-sheet-chip-button ${details.key}`}
                  onClick={() => handleTagClick(tag)}
                  type="button"
                  title={`${details.label} · ${count} posts`}
                >
                  <span className="tag-chip-label">{tag}</span>
                  <span className="tag-chip-count">{count}</span>
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>,
    document.body,
  )
}
