import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { testCredentials } from '../lib/api'
import { EXCLUDE_FILTERS } from '../lib/preferences'
import { clearAllLocalData, getLibraryCounts } from '../lib/storage'
import { useAppContext } from '../state/useAppContext'
import type { ApiCredentials, ExcludeFilterId } from '../types'

type StatusKind = 'success' | 'error' | 'info'
type ValidationState = {
  credentialKey: string
  kind: StatusKind
  message: string
  testing: boolean
}

export function SettingsPage() {
  const { libraryVersion, preferences, updatePreferences, mutedTags, toggleMutedTag } =
    useAppContext()
  const [userId, setUserId] = useState(preferences.credentials.userId)
  const [apiKey, setApiKey] = useState(preferences.credentials.apiKey)
  const [validationState, setValidationState] = useState<ValidationState>({
    credentialKey: '',
    kind: 'info',
    message: '',
    testing: false,
  })
  const [counts, setCounts] = useState({ saved: 0, downloads: 0, history: 0 })
  const validationRef = useRef(0)

  useEffect(() => {
    void getLibraryCounts().then(setCounts)
  }, [libraryVersion])

  const trimmedUserId = userId.trim()
  const trimmedApiKey = apiKey.trim()
  const credentialKey = `${trimmedUserId}::${trimmedApiKey}`

  useEffect(() => {
    const validationId = validationRef.current + 1
    validationRef.current = validationId

    if (!trimmedUserId || !trimmedApiKey) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (validationRef.current !== validationId) {
        return
      }

      setValidationState({
        credentialKey,
        kind: 'info',
        message: 'Saved locally. Checking credentials…',
        testing: true,
      })

      void testCredentials({ userId: trimmedUserId, apiKey: trimmedApiKey })
        .then(() => {
          if (validationRef.current !== validationId) {
            return
          }
          setValidationState({
            credentialKey,
            kind: 'success',
            message: 'Credentials saved. Connection looks good.',
            testing: false,
          })
        })
        .catch((error) => {
          if (validationRef.current !== validationId) {
            return
          }
          setValidationState({
            credentialKey,
            kind: 'error',
            message: error instanceof Error ? error.message : 'Connection test failed.',
            testing: false,
          })
        })
    }, 450)

    return () => window.clearTimeout(timeoutId)
  }, [credentialKey, trimmedApiKey, trimmedUserId])

  const handleCredentialChange = (field: keyof ApiCredentials, value: string) => {
    if (field === 'userId') {
      setUserId(value)
    } else {
      setApiKey(value)
    }

    updatePreferences({
      credentials: {
        [field]: value,
      },
    })
  }

  const toggleExcludeFilter = (filterId: ExcludeFilterId, enabled: boolean) => {
    updatePreferences({
      excludeFilters: {
        [filterId]: !enabled,
      },
    })
  }

  const handleReset = async () => {
    if (!window.confirm('Clear local preferences, saved posts, download history, and muted tags?')) {
      return
    }

    await clearAllLocalData()
    window.location.reload()
  }

  const hasUserId = Boolean(trimmedUserId)
  const hasApiKey = Boolean(trimmedApiKey)
  const hasCompleteCredentials = hasUserId && hasApiKey
  const activeValidation =
    validationState.credentialKey === credentialKey ? validationState : undefined
  const testing = activeValidation?.testing ?? false
  const status = !hasUserId && !hasApiKey
    ? 'Credentials autosave locally and only stay in this browser.'
    : !hasCompleteCredentials
      ? 'Saved locally. Fill both fields to verify the connection.'
      : activeValidation?.message ?? 'Saved locally. Checking credentials…'
  const statusKind = !hasCompleteCredentials ? 'info' : (activeValidation?.kind ?? 'info')
  const formTone = !hasCompleteCredentials ? 'idle' : testing ? 'loading' : statusKind
  const showError = statusKind === 'error' && Boolean(activeValidation?.message)
  const libraryTotal = counts.saved + counts.downloads + counts.history

  const behaviorOptions = [
    {
      label: 'Haptics',
      description: 'Use vibration feedback where the device supports it.',
      enabled: preferences.hapticsEnabled,
      onToggle: () => updatePreferences({ hapticsEnabled: !preferences.hapticsEnabled }),
    },
    {
      label: 'Autoplay',
      description: 'Start videos automatically when they enter view.',
      enabled: preferences.autoplayEnabled,
      onToggle: () => updatePreferences({ autoplayEnabled: !preferences.autoplayEnabled }),
    },
    {
      label: 'Share-first on mobile',
      description: 'Keep sharing ahead of download actions on smaller screens.',
      enabled: preferences.preferShareOnMobile,
      onToggle: () =>
        updatePreferences({
          preferShareOnMobile: !preferences.preferShareOnMobile,
        }),
    },
  ]

  const storageStats = [
    { label: 'Saved posts', value: counts.saved },
    { label: 'Downloads', value: counts.downloads },
    { label: 'History', value: counts.history },
    { label: 'Muted tags', value: mutedTags.size },
  ]

  return (
    <div className="page settings-page">
      <section className="page-header settings-header">
        <h1>Settings</h1>
        <p className="muted">Everything here saves locally.</p>
      </section>

      <div className="settings-layout">
        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Account</h2>
          </header>

          <form
            className={`settings-form-grid settings-account-form is-${formTone}`}
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="settings-account-meta">
              <div className="settings-account-copy">
                <p className="settings-account-note muted">
                  Find these on{' '}
                  <a
                    href="https://rule34.xxx/index.php?page=account&s=options"
                    rel="noreferrer"
                    target="_blank"
                  >
                    rule34.xxx account options
                  </a>{' '}
                  and look for the API access credentials.
                </p>
                <p className={`settings-account-feedback is-${formTone}`}>{status}</p>
              </div>
              {testing ? (
                <span
                  aria-live="polite"
                  aria-label="Verifying credentials"
                  className="settings-account-spinner"
                  role="status"
                >
                  <LoaderCircle aria-hidden="true" className="spinner" size={16} />
                </span>
              ) : null}
            </div>

            <label className="settings-field">
              <span className="settings-field-label">User ID</span>
              <div className="settings-input-shell">
                <input
                  autoComplete="off"
                  className="field"
                  inputMode="numeric"
                  name="userId"
                  onChange={(event) => handleCredentialChange('userId', event.target.value)}
                  placeholder="12345"
                  spellCheck={false}
                  value={userId}
                />
              </div>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">API key</span>
              <div className="settings-input-shell">
                <input
                  autoComplete="off"
                  className="field"
                  name="apiKey"
                  onChange={(event) => handleCredentialChange('apiKey', event.target.value)}
                  placeholder="API key"
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                />
              </div>
            </label>

            {showError ? (
              <div aria-live="assertive" className="settings-account-error" role="alert">
                {activeValidation?.message}
              </div>
            ) : null}
          </form>
        </section>

        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Content filters</h2>
          </header>

          <div className="settings-list">
            {EXCLUDE_FILTERS.map((filter) => {
              const enabled = preferences.excludeFilters[filter.id]
              const filterTagPreview = filter.tags.map((tag) => `-${tag}`).join(' ')

              return (
                <label className="settings-row settings-row-toggle" key={filter.id}>
                  <div className="settings-row-copy">
                    <span className="settings-row-title">{filter.label}</span>
                    <span className="settings-filter-card mono">{filterTagPreview}</span>
                  </div>
                  <span className="settings-switch">
                    <input
                      checked={enabled}
                      className="settings-switch-input"
                      onChange={() => toggleExcludeFilter(filter.id, enabled)}
                      type="checkbox"
                    />
                    <span className="settings-switch-track">
                      <span className="settings-switch-thumb" />
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Browsing</h2>
          </header>

          <div className="settings-list">
            <div className="settings-row settings-row-stack">
              <div className="settings-row-copy">
                <span className="settings-row-title">Grid columns</span>
                <span className="settings-row-note">Choose how dense the feed should look.</span>
              </div>
              <div className="settings-range-row">
                <input
                  max={5}
                  min={1}
                  onChange={(event) =>
                    updatePreferences({ masonryColumns: Number(event.target.value) })
                  }
                  type="range"
                  value={preferences.masonryColumns}
                />
                <span className="range-value">{preferences.masonryColumns}</span>
              </div>
            </div>

            {behaviorOptions.map((option) => (
              <label className="settings-row settings-row-toggle" key={option.label}>
                <div className="settings-row-copy">
                  <span className="settings-row-title">{option.label}</span>
                  <span className="settings-row-note">{option.description}</span>
                </div>
                <span className="settings-switch">
                  <input
                    checked={option.enabled}
                    className="settings-switch-input"
                    onChange={option.onToggle}
                    type="checkbox"
                  />
                  <span className="settings-switch-track">
                    <span className="settings-switch-thumb" />
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Appearance</h2>
          </header>

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-title">Accent color</span>
              </div>
              <div className="settings-color-control">
                <input
                  className="color-field"
                  onChange={(event) => updatePreferences({ accentColor: event.target.value })}
                  type="color"
                  value={preferences.accentColor}
                />
                <span className="settings-color-value mono">{preferences.accentColor}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Muted tags</h2>
          </header>

          {mutedTags.size > 0 ? (
            <div className="chip-row">
              {[...mutedTags].map((tag) => (
                <button
                  className="chip active"
                  key={tag}
                  onClick={() => void toggleMutedTag(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No muted tags yet.</p>
          )}
        </section>

        <section className="settings-card">
          <header className="settings-card-heading">
            <h2>Local data</h2>
          </header>

          <div className="settings-stats-list">
            {storageStats.map((item) => (
              <div className="settings-stat-line" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <p className="footer-note">{libraryTotal} items stored on this device.</p>

          <button className="button-danger" onClick={() => void handleReset()} type="button">
            Clear local data
          </button>
        </section>
      </div>
    </div>
  )
}
