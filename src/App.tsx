import { ArrowDown, ArrowUp, Bookmark, Home, RefreshCw, Search, Settings } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import { InstallBanner } from './components/InstallBanner'
import {
  triggerScrollResetHintHaptic,
  triggerScrollResetReadyHaptic,
  triggerScrollResetTriggerHaptic,
} from './lib/device'
import { HomePage } from './pages/HomePage'
import { PostPage } from './pages/PostPage'
import { SavedPage } from './pages/SavedPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { TagRedirectPage } from './pages/TagRedirectPage'
import { useAppContext } from './state/useAppContext'

type TabId = 'home' | 'search' | 'saved' | 'settings'
type ResettableTabId = Extract<TabId, 'home' | 'search'>

type PullCueState = {
  detail: string
  distance: number
  ready: boolean
  refreshing: boolean
  title: string
  visible: boolean
}

type PullGestureState = {
  hintHapticFired: boolean
  id: number
  pulling: boolean
  readyHapticFired: boolean
  startY: number
}

const NAV_ITEMS: Array<{ icon: typeof Home; id: TabId; label: string; to: string }> = [
  { to: '/', label: 'Home', icon: Home, id: 'home' },
  { to: '/search', label: 'Search', icon: Search, id: 'search' },
  { to: '/saved', label: 'Saved', icon: Bookmark, id: 'saved' },
  { to: '/settings', label: 'Settings', icon: Settings, id: 'settings' },
]
const PULL_REFRESH_THRESHOLD = 92
const PULL_MAX_DISTANCE = 132
const PULL_REFRESH_HOLD_DISTANCE = 58
const PULL_REFRESH_SETTLE_MS = 820
const BACK_TO_TOP_SHOW_DEPTH = 1200
const BACK_TO_TOP_SHOW_MIN_DELTA = 90
const BACK_TO_TOP_HIDE_MIN_DELTA = 120
const BACK_TO_TOP_NEAR_TOP = 200
const NAV_HIDE_SCROLL_START = 120
const NAV_SHOW_MIN_UP_DELTA = 72
const INITIAL_SCROLL_POSITIONS: Record<TabId, number> = {
  home: 0,
  search: 0,
  saved: 0,
  settings: 0,
}
const HIDDEN_PULL_CUE: PullCueState = {
  detail: '',
  distance: 0,
  ready: false,
  refreshing: false,
  title: '',
  visible: false,
}

function activeNavIndex(pathname: string) {
  const index = NAV_ITEMS.findIndex((item) =>
    item.to === '/' ? pathname === '/' : pathname.startsWith(item.to),
  )
  return index >= 0 ? index : 0
}

function activeTabId(pathname: string): TabId | null {
  if (pathname === '/') {
    return 'home'
  }

  const match = NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to))
  return match?.id ?? null
}

function isResettableTab(tabId: TabId | null): tabId is ResettableTabId {
  return tabId === 'home' || tabId === 'search'
}

function isStandaloneRoute(pathname: string) {
  return pathname.startsWith('/post/') || pathname.startsWith('/tag/')
}

function applyPullResistance(distance: number) {
  if (distance <= 0) {
    return 0
  }

  return Math.min(PULL_MAX_DISTANCE, PULL_MAX_DISTANCE * (1 - Math.exp(-distance / 120)))
}

function createPullCue(tabId: ResettableTabId, distance: number, ready: boolean): PullCueState {
  return {
    detail: ready ? 'Release to reload' : 'Pull past the top to reload',
    distance,
    ready,
    refreshing: false,
    title: tabId === 'home' ? 'Refresh home feed' : 'Refresh search results',
    visible: true,
  }
}

function createRefreshingCue(tabId: ResettableTabId): PullCueState {
  return {
    detail: 'Reloading from the top',
    distance: PULL_REFRESH_HOLD_DISTANCE,
    ready: true,
    refreshing: true,
    title: tabId === 'home' ? 'Refreshing home' : 'Refreshing search',
    visible: true,
  }
}

function App() {
  const location = useLocation()
  const { preferences } = useAppContext()
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [navHidden, setNavHidden] = useState(false)
  const [pageResetTokens, setPageResetTokens] = useState<Record<ResettableTabId, number>>({
    home: 0,
    search: 0,
  })
  const [pullCue, setPullCue] = useState(HIDDEN_PULL_CUE)
  const currentNavIndex = activeNavIndex(location.pathname)
  const currentTabId = activeTabId(location.pathname)
  const showingStandalonePage = isStandaloneRoute(location.pathname)
  const pullEnabled = isResettableTab(currentTabId) && !showingStandalonePage
  const scrollPositionsRef = useRef(INITIAL_SCROLL_POSITIONS)
  const scrollDirectionRef = useRef(0)
  const upScrollDeltaRef = useRef(0)
  const downScrollDeltaRef = useRef(0)
  const navUpScrollDeltaRef = useRef(0)
  const lastScrollYRef = useRef(window.scrollY)
  const lastSearchRef = useRef(location.search)
  const pullCueRef = useRef(HIDDEN_PULL_CUE)
  const pullGestureRef = useRef<PullGestureState | null>(null)
  const refreshTimeoutRef = useRef<number | null>(null)
  const refreshingTabRef = useRef<ResettableTabId | null>(null)

  const triggerTabReset = useCallback((tabId: ResettableTabId) => {
    refreshingTabRef.current = tabId
    scrollPositionsRef.current[tabId] = 0
    lastScrollYRef.current = 0
    pullCueRef.current = createRefreshingCue(tabId)
    setPullCue(pullCueRef.current)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setPageResetTokens((current) => ({
      ...current,
      [tabId]: current[tabId] + 1,
    }))
    triggerScrollResetTriggerHaptic(preferences.hapticsEnabled)

    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current)
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshingTabRef.current = null
      pullCueRef.current = HIDDEN_PULL_CUE
      setPullCue(HIDDEN_PULL_CUE)
      refreshTimeoutRef.current = null
    }, PULL_REFRESH_SETTLE_MS)
  }, [preferences.hapticsEnabled])

  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY
      const lastY = lastScrollYRef.current
      const deltaY = currentY - lastY
      const direction = deltaY > 0 ? 1 : deltaY < 0 ? -1 : scrollDirectionRef.current

      if (currentTabId) {
        scrollPositionsRef.current[currentTabId] = currentY
      }

      if (!pullGestureRef.current) {
        if (deltaY < 0) {
          navUpScrollDeltaRef.current += -deltaY
        } else if (deltaY > 0) {
          navUpScrollDeltaRef.current = 0
        }

        if (currentY <= NAV_HIDE_SCROLL_START) {
          setNavHidden(false)
          navUpScrollDeltaRef.current = 0
        } else if (deltaY > 0) {
          setNavHidden(true)
        } else if (deltaY < 0 && navUpScrollDeltaRef.current >= NAV_SHOW_MIN_UP_DELTA) {
          setNavHidden(false)
          navUpScrollDeltaRef.current = 0
        }
      }

      if (!showingStandalonePage) {
        const nearTop = currentY < BACK_TO_TOP_NEAR_TOP

        if (deltaY < 0) {
          upScrollDeltaRef.current += -deltaY
          downScrollDeltaRef.current = 0
        } else if (deltaY > 0) {
          downScrollDeltaRef.current += deltaY
          upScrollDeltaRef.current = 0
        }

        if (
          direction < 0 &&
          currentY > BACK_TO_TOP_SHOW_DEPTH &&
          upScrollDeltaRef.current >= BACK_TO_TOP_SHOW_MIN_DELTA
        ) {
          setShowBackToTop(true)
          upScrollDeltaRef.current = 0
          downScrollDeltaRef.current = 0
        }

        if (
          nearTop ||
          (direction > 0 && downScrollDeltaRef.current >= BACK_TO_TOP_HIDE_MIN_DELTA)
        ) {
          setShowBackToTop(false)
          upScrollDeltaRef.current = 0
          downScrollDeltaRef.current = 0
        }
      } else {
        setShowBackToTop(false)
      }

      scrollDirectionRef.current = direction
      lastScrollYRef.current = currentY
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [currentTabId, showingStandalonePage])

  useLayoutEffect(() => {
    scrollDirectionRef.current = 0
    upScrollDeltaRef.current = 0
    downScrollDeltaRef.current = 0
    setShowBackToTop(false)
  }, [currentTabId, showingStandalonePage])

  useEffect(() => {
    if (!pullEnabled) {
      pullGestureRef.current = null
      if (!pullCueRef.current.refreshing) {
        pullCueRef.current = HIDDEN_PULL_CUE
        const frameId = window.requestAnimationFrame(() => {
          setPullCue(HIDDEN_PULL_CUE)
        })

        return () => window.cancelAnimationFrame(frameId)
      }
      return
    }

    const setCue = (next: PullCueState) => {
      pullCueRef.current = next
      setPullCue(next)
    }

    const endPullGesture = () => {
      const gesture = pullGestureRef.current
      pullGestureRef.current = null

      if (!gesture?.pulling) {
        if (!pullCueRef.current.refreshing && pullCueRef.current.visible) {
          setCue(HIDDEN_PULL_CUE)
        }
        return
      }

      if (pullCueRef.current.ready && isResettableTab(currentTabId)) {
        triggerTabReset(currentTabId)
        return
      }

      if (!pullCueRef.current.refreshing) {
        setCue(HIDDEN_PULL_CUE)
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || window.scrollY > 0 || refreshingTabRef.current) {
        pullGestureRef.current = null
        return
      }

      const touch = event.touches[0]
      pullGestureRef.current = {
        hintHapticFired: false,
        id: touch.identifier,
        pulling: false,
        readyHapticFired: false,
        startY: touch.clientY,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const gesture = pullGestureRef.current
      if (!gesture || refreshingTabRef.current) {
        return
      }

      const touch = [...event.touches].find((entry) => entry.identifier === gesture.id)
      if (!touch) {
        return
      }

      if (window.scrollY > 0 && !gesture.pulling) {
        pullGestureRef.current = null
        return
      }

      const deltaY = touch.clientY - gesture.startY
      if (deltaY <= 0) {
        return
      }

      const distance = applyPullResistance(deltaY)
      if (distance <= 0) {
        return
      }

      gesture.pulling = true
      event.preventDefault()

      if (!gesture.hintHapticFired) {
        gesture.hintHapticFired = true
        triggerScrollResetHintHaptic(preferences.hapticsEnabled)
      }

      const ready = distance >= PULL_REFRESH_THRESHOLD
      if (ready && !gesture.readyHapticFired) {
        gesture.readyHapticFired = true
        triggerScrollResetReadyHaptic(preferences.hapticsEnabled)
      }

      setCue(createPullCue(currentTabId, distance, ready))
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', endPullGesture)
    window.addEventListener('touchcancel', endPullGesture)

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', endPullGesture)
      window.removeEventListener('touchcancel', endPullGesture)
      pullGestureRef.current = null
    }
  }, [currentTabId, pullEnabled, preferences.hapticsEnabled, triggerTabReset])

  useLayoutEffect(() => {
    if (!currentTabId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const targetY = scrollPositionsRef.current[currentTabId] ?? 0
      window.scrollTo({ top: targetY, left: 0, behavior: 'auto' })
      lastScrollYRef.current = targetY
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [currentTabId])

  useLayoutEffect(() => {
    if (currentTabId !== 'search') {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (lastSearchRef.current === location.search) {
        return
      }

      lastSearchRef.current = location.search
      scrollPositionsRef.current.search = 0
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      lastScrollYRef.current = 0
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [currentTabId, location.search])

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [])

  const pullProgress = Math.min(1, pullCue.distance / PULL_REFRESH_THRESHOLD)
  const showPullCue = pullEnabled && pullCue.visible
  const pullOffset = showPullCue ? pullCue.distance : 0

  return (
    <div className="app-shell">
      <main
        className={`app-main${showPullCue ? ' is-pulling' : ''}${pullCue.refreshing ? ' is-refreshing' : ''}`}
        style={{ ['--pull-offset' as string]: `${pullOffset}px` }}
      >
        <section
          aria-hidden={currentTabId !== 'home' || showingStandalonePage}
          className={`tab-panel${currentTabId === 'home' && !showingStandalonePage ? ' active' : ''}`}
          hidden={currentTabId !== 'home' || showingStandalonePage}
        >
          <HomePage key={`home-${pageResetTokens.home}`} />
        </section>
        <section
          aria-hidden={currentTabId !== 'search' || showingStandalonePage}
          className={`tab-panel${currentTabId === 'search' && !showingStandalonePage ? ' active' : ''}`}
          hidden={currentTabId !== 'search' || showingStandalonePage}
        >
          <SearchPage key={`search-${pageResetTokens.search}`} />
        </section>
        <section
          aria-hidden={currentTabId !== 'saved' || showingStandalonePage}
          className={`tab-panel${currentTabId === 'saved' && !showingStandalonePage ? ' active' : ''}`}
          hidden={currentTabId !== 'saved' || showingStandalonePage}
        >
          <SavedPage />
        </section>
        <section
          aria-hidden={currentTabId !== 'settings' || showingStandalonePage}
          className={`tab-panel${currentTabId === 'settings' && !showingStandalonePage ? ' active' : ''}`}
          hidden={currentTabId !== 'settings' || showingStandalonePage}
        >
          <SettingsPage />
        </section>

        {showingStandalonePage ? (
          <Routes>
            <Route path="/post/:postId" element={<PostPage />} />
            <Route path="/tag/:tag" element={<TagRedirectPage />} />
          </Routes>
        ) : null}
      </main>

      <InstallBanner />

      <button
        aria-label={pullCue.title || 'Refresh feed'}
        className={`scroll-reset-indicator${showPullCue ? ' visible' : ''}${pullCue.ready ? ' armed' : ''}${pullCue.refreshing ? ' refreshing' : ''}`}
        onClick={() => {
          if (pullEnabled && isResettableTab(currentTabId)) {
            triggerTabReset(currentTabId)
          }
        }}
        style={{ ['--reset-progress' as string]: String(pullProgress) }}
        type="button"
      >
        <span aria-hidden="true" className="scroll-reset-indicator-progress" />
        <span className="scroll-reset-indicator-icon">
          {pullCue.refreshing ? (
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2.1} />
          ) : (
            <ArrowDown aria-hidden="true" size={18} strokeWidth={2.2} />
          )}
        </span>
        <span className="scroll-reset-indicator-copy">
          <strong>{pullCue.title}</strong>
          <span>{pullCue.detail}</span>
        </span>
      </button>

      <button
        aria-label="Back to top"
        className={`back-to-top-button${showBackToTop ? ' visible' : ''}`}
        onClick={() => {
          setShowBackToTop(false)
          scrollDirectionRef.current = 0
          upScrollDeltaRef.current = 0
          downScrollDeltaRef.current = 0
          window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
        }}
        type="button"
      >
        <ArrowUp aria-hidden="true" size={20} strokeWidth={2.35} />
      </button>

      <nav
        aria-label="Primary"
        className={`bottom-nav${navHidden ? ' hidden' : ''}`}
        style={
          {
            ['--active-index' as string]: currentNavIndex,
            ['--nav-count' as string]: NAV_ITEMS.length,
          } as CSSProperties
        }
      >
        <span aria-hidden="true" className="bottom-nav-indicator" />
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            className={({ isActive }) =>
              `bottom-link${
                item.to !== '/' && location.pathname.startsWith(item.to)
                  ? ' active'
                  : isActive
                    ? ' active'
                    : ''
              }`
            }
            to={item.to}
          >
            <item.icon aria-hidden="true" size={18} strokeWidth={2} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default App
