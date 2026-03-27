import { LoaderCircle, Search } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { fetchTagMeta, fetchTagSuggestions } from '../lib/api'
import { triggerSearchTokenSwapHaptic } from '../lib/device'
import { getSourceLabel } from '../lib/sources'
import { getTagTypeDetails } from '../lib/tagMeta'
import type { ApiCredentials, SourceId, TagSummary } from '../types'
import { SourceIcon } from './SourceMark'

const SKELETON_ROWS = 5
const TOKEN_MODE_SWAP_HOLD_MS = 340

function splitQueryTokens(query: string) {
  return query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function currentToken(token: string) {
  const excluded = token.startsWith('-')
  return {
    excluded,
    value: excluded ? token.slice(1) : token,
  }
}

function normaliseToken(token: string) {
  return token.trim().replace(/\s+/g, '_')
}

function normaliseDraftInput(value: string) {
  return value.replace(/\s/g, '_')
}

function toggleTokenMode(token: string) {
  return token.startsWith('-') ? token.slice(1) : `-${token}`
}

export function SearchComposer({
  source,
  credentials,
  hapticsEnabled,
  initialValue = '',
  onSourceChange,
  onSubmit,
  submitting = false,
}: {
  source: SourceId
  credentials?: ApiCredentials
  hapticsEnabled: boolean
  initialValue?: string
  onSourceChange: (source: SourceId) => void
  onSubmit: (query: string) => void
  submitting?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [tokens, setTokens] = useState<string[]>(() => splitQueryTokens(initialValue))
  const [suggestions, setSuggestions] = useState<TagSummary[]>([])
  const [tokenMeta, setTokenMeta] = useState<Map<string, TagSummary>>(new Map())
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestedTerm, setSuggestedTerm] = useState('')
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const deferredDraft = useDeferredValue(draft)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sourceMenuRef = useRef<HTMLDivElement | null>(null)
  const tokenHoldTimerRef = useRef<number | null>(null)
  const suppressTokenClickRef = useRef<number | null>(null)
  const [showSourceMenu, setShowSourceMenu] = useState(false)
  const token = currentToken(deferredDraft)
  const pendingToken = normaliseToken(draft)
  const canSubmit = tokens.length > 0 || Boolean(pendingToken)
  const matchingSuggestions = suggestedTerm === token.value ? suggestions : []
  const showLoadingSuggestions =
    token.value.length >= 2 && suggestedTerm === token.value && loadingSuggestions

  const withTokenPrefix = (value: string) => {
    const prefixed = token.excluded && !value.startsWith('-') ? `-${value}` : value
    return normaliseToken(prefixed)
  }

  const commitToken = (value: string) => {
    const next = normaliseToken(value)
    if (!next) {
      return
    }

    setTokens((current) => (current.includes(next) ? current : [...current, next]))
    setDraft('')
    setSuggestions([])
    setSuggestedTerm('')
    setActiveSuggestionIndex(0)
  }

  const submitSearch = () => {
    const nextTokens = [...tokens]
    const pending = pendingToken

    if (pending && !nextTokens.includes(pending)) {
      nextTokens.push(pending)
    }

    onSubmit(nextTokens.join(' '))
    setTokens(nextTokens)
    setDraft('')
    setSuggestions([])
    setSuggestedTerm('')
    setActiveSuggestionIndex(0)
  }

  const selectSuggestion = (name: string) => {
    commitToken(withTokenPrefix(name))
  }

  const clearTokenHoldTimer = () => {
    if (tokenHoldTimerRef.current !== null) {
      window.clearTimeout(tokenHoldTimerRef.current)
      tokenHoldTimerRef.current = null
    }
  }

  const startTokenHold = (index: number) => {
    clearTokenHoldTimer()
    suppressTokenClickRef.current = null
    tokenHoldTimerRef.current = window.setTimeout(() => {
      suppressTokenClickRef.current = index
      triggerSearchTokenSwapHaptic(hapticsEnabled)
      setTokens((current) =>
        current.map((entry, tokenIndex) =>
          tokenIndex === index ? toggleTokenMode(entry) : entry,
        ),
      )
      tokenHoldTimerRef.current = null
    }, TOKEN_MODE_SWAP_HOLD_MS)
  }

  const releaseTokenHold = () => {
    clearTokenHoldTimer()
    if (suppressTokenClickRef.current !== null) {
      window.setTimeout(() => {
        suppressTokenClickRef.current = null
      }, 0)
    }
  }

  const removeToken = (index: number) => {
    setTokens((current) => current.filter((_, tokenIndex) => tokenIndex !== index))
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (tokens.length === 0) {
        setTokenMeta(new Map())
        return
      }

      const tagNames = [...new Set(tokens.map((entry) => currentToken(entry).value).filter(Boolean))]

      try {
        const next = await fetchTagMeta({ source, credentials, tags: tagNames })
        if (!cancelled) {
          setTokenMeta(next)
        }
      } catch {
        if (!cancelled) {
          setTokenMeta(new Map())
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [credentials, source, tokens])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!token.value || token.value.length < 2) {
        setLoadingSuggestions(false)
        setSuggestions([])
        setSuggestedTerm('')
        setActiveSuggestionIndex(0)
        return
      }

      setLoadingSuggestions(true)
      setSuggestions([])
      setSuggestedTerm(token.value)
      setActiveSuggestionIndex(0)

      try {
        const next = await fetchTagSuggestions({ source, credentials, term: token.value })
        if (cancelled) {
          return
        }

        setSuggestions(next)
        setSuggestedTerm(token.value)
        setLoadingSuggestions(false)

        if ((!credentials?.userId || !credentials?.apiKey) && source === 'rule34') {
          return
        }

        if (next.length === 0) {
          return
        }

        try {
          const meta = await fetchTagMeta({
            source,
            credentials,
            tags: next.map((entry) => entry.name),
          })

          if (!cancelled) {
            setSuggestions(
              next.map((entry) => {
                const enriched = meta.get(entry.name)
                if (!enriched) {
                  return entry
                }

                return {
                  ...entry,
                  count: enriched.count || entry.count,
                  type: enriched.type,
                }
              }),
            )
          }
        } catch {
          // Autocomplete already has usable data without meta enrichment.
        }
      } catch {
        if (!cancelled) {
          setSuggestions([])
          setSuggestedTerm(token.value)
          setLoadingSuggestions(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [credentials, source, token.value])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSuggestions([])
        setSuggestedTerm('')
        setShowSourceMenu(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => clearTokenHoldTimer, [])

  return (
    <div className="search-composer" ref={rootRef}>
      <div className="search-bar-shell">
        <div className={`search-bar${submitting ? ' is-searching' : ''}`}>
          <div className="search-provider-shell" ref={sourceMenuRef}>
            <button
              aria-expanded={showSourceMenu}
              aria-haspopup="menu"
              aria-label={`Search provider: ${getSourceLabel(source)}`}
              className={`search-provider-button${showSourceMenu ? ' open' : ''}`}
              onClick={() => setShowSourceMenu((current) => !current)}
              type="button"
            >
              <SourceIcon label="" size={18} source={source} />
            </button>

            {showSourceMenu ? (
              <div className="search-provider-menu" role="menu">
                {(['rule34', 'realbooru'] as const).map((provider) => (
                  <button
                    aria-pressed={provider === source}
                    className={`search-provider-option${provider === source ? ' active' : ''}`}
                    key={provider}
                    onClick={() => {
                      onSourceChange(provider)
                      setShowSourceMenu(false)
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <SourceIcon label="" size={18} source={provider} />
                    <span>{getSourceLabel(provider)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <input
            aria-label="Search tags"
            autoComplete="off"
            className="field"
            onChange={(event) => {
              setDraft(normaliseDraftInput(event.target.value))
              setActiveSuggestionIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && matchingSuggestions.length > 0) {
                event.preventDefault()
                setActiveSuggestionIndex(
                  (current) => (current + 1) % matchingSuggestions.length,
                )
                return
              }

              if (event.key === 'ArrowUp' && matchingSuggestions.length > 0) {
                event.preventDefault()
                setActiveSuggestionIndex(
                  (current) =>
                    (current - 1 + matchingSuggestions.length) % matchingSuggestions.length,
                )
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                if (matchingSuggestions[activeSuggestionIndex]) {
                  selectSuggestion(matchingSuggestions[activeSuggestionIndex].name)
                  return
                }
                commitToken(draft)
                return
              }

              if (event.key === 'Escape') {
                setSuggestions([])
                setSuggestedTerm('')
                setActiveSuggestionIndex(0)
                return
              }

              if (event.key === 'Backspace' && !draft && tokens.length > 0) {
                event.preventDefault()
                setTokens((current) => current.slice(0, -1))
              }
            }}
            placeholder="Search tags, use -tag to exclude"
            value={draft}
          />
          <button
            aria-busy={submitting}
            aria-label={submitting ? 'Searching' : 'Find posts'}
            className={`button-primary search-submit search-submit-circle${submitting ? ' is-loading' : ''}`}
            disabled={submitting || !canSubmit}
            onClick={submitSearch}
            type="button"
          >
            {submitting ? (
              <LoaderCircle aria-hidden="true" className="spinner" size={18} />
            ) : (
              <Search aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        {showLoadingSuggestions ? (
          <div className="search-dropdown" role="status">
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <div className="search-suggestion search-suggestion-skeleton" key={`skeleton-${index}`}>
                <span className="search-suggestion-copy">
                  <span className="search-skeleton-line search-skeleton-name" />
                  <span className="search-skeleton-line search-skeleton-type" />
                </span>
                <span className="search-skeleton-line search-skeleton-count" />
              </div>
            ))}
          </div>
        ) : token.value && matchingSuggestions.length > 0 ? (
          <div className="search-dropdown" role="listbox">
            {matchingSuggestions.map((tag, index) => {
              const details = getTagTypeDetails(tag.type)
              return (
                <button
                  aria-selected={activeSuggestionIndex === index}
                  className={`search-suggestion ${details.key}${activeSuggestionIndex === index ? ' active' : ''}`}
                  key={`${tag.id}-${tag.name}`}
                  onClick={() => selectSuggestion(tag.name)}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  type="button"
                >
                  <span className="search-suggestion-copy">
                    <span className={`tag-chip tag-chip-inline ${details.key}`}>
                      <span className="tag-chip-label">{`${token.excluded ? '-' : ''}${tag.name}`}</span>
                    </span>
                    <span className={`search-suggestion-type ${details.key}`}>{details.label}</span>
                  </span>
                  <span
                    aria-label={`${tag.count.toLocaleString()} posts`}
                    className="search-suggestion-count"
                    title={`${tag.count.toLocaleString()} posts`}
                  >
                    {tag.count.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        ) : token.value.length >= 2 && suggestedTerm === token.value ? (
          <div className="search-dropdown search-dropdown-empty" role="status">
            <span>No autocomplete hit yet.</span>
            <strong>Press Enter to add “{withTokenPrefix(token.value)}”.</strong>
          </div>
        ) : null}
      </div>
      {tokens.length > 0 ? (
        <div className="search-token-card">
          <div className="search-token-list" role="list">
            {tokens.map((entry, index) => {
              const entryToken = currentToken(entry)
              const details = getTagTypeDetails(tokenMeta.get(entryToken.value)?.type ?? 0)

              return (
                <button
                  aria-label={
                    entryToken.excluded
                      ? `Remove ${entry}. Hold to switch it to include.`
                      : `Remove ${entry}. Hold to switch it to exclude.`
                  }
                  className={`search-token${entryToken.excluded ? ' excluded' : ''}`}
                  key={`${entry}-${index}`}
                  onClick={() => {
                    if (suppressTokenClickRef.current === index) {
                      suppressTokenClickRef.current = null
                      return
                    }
                    removeToken(index)
                  }}
                  onPointerCancel={releaseTokenHold}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return
                    }
                    startTokenHold(index)
                  }}
                  onPointerLeave={releaseTokenHold}
                  onPointerUp={releaseTokenHold}
                  title={
                    entryToken.excluded
                      ? 'Tap to remove. Hold to switch to include.'
                      : 'Tap to remove. Hold to switch to exclude.'
                  }
                  type="button"
                >
                  <span className={`tag-chip tag-chip-inline search-token-chip ${details.key}`}>
                    <span className="tag-chip-label">{entry}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
