import { ChevronDown, Download, Heart, MoreVertical, Tags } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  saveMedia,
  triggerHaptic,
  triggerHoldMenuHoverHaptic,
  triggerHoldMenuOpenHaptic,
  triggerHoldMenuSelectionHaptic,
} from '../lib/device'
import { useScrollLock } from '../hooks/useScrollLock'
import { getCardMediaUrl, getMediaPosterUrl } from '../lib/media'
import { useAppContext } from '../state/useAppContext'
import type { FeedItem } from '../types'
import { HoldMenuGlass } from './HoldMenuGlass'
import { SyncedVideo } from './SyncedVideo'
import { PostViewer } from './PostViewer'
import { TagSheet } from './TagSheet'

type HoldAction = 'like' | 'tags' | 'download'
type ActionSource = 'default' | 'hold-menu'

interface HoldMenuState {
  activeAction: HoldAction | null
  x: number
  y: number
}

const HOLD_DELAY_MS = 280
const HOLD_MENU_EXIT_MS = 180
const DOUBLE_TAP_MS = 260
const HOLD_MOVEMENT_PX = 14
const HOLD_ACTION_SIZE_PX = 72
const HOLD_ACTION_TRIGGER_PX = 42
const VIEWER_SWIPE_HINT_MS = 2200
const LONG_POST_RATIO = 1.85
const MENU_ACTIONS = [
  { action: 'like', dx: 0, dy: -88, icon: Heart, label: 'Like post' },
  { action: 'tags', dx: -74, dy: -22, icon: Tags, label: 'Show tags' },
  { action: 'download', dx: 74, dy: -22, icon: Download, label: 'Download media' },
] satisfies Array<{
  action: HoldAction
  dx: number
  dy: number
  icon: typeof Heart
  label: string
}>

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function safelySetPointerCapture(
  element: HTMLDivElement | HTMLButtonElement,
  pointerId: number,
) {
  if (!('setPointerCapture' in element)) {
    return
  }

  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Some mobile browsers can reject pointer capture for touch; the hold gesture should still work.
  }
}

function renderMedia(
  post: FeedItem,
  autoplayEnabled: boolean,
  mediaLoaded: boolean,
  onMediaReady: () => void,
) {
  if (post.mediaType === 'video') {
    const playbackUrl = getCardMediaUrl(post)

    if (!playbackUrl) {
      return null
    }

    return (
      <SyncedVideo
        autoPlay={autoplayEnabled}
        controls
        defaultMuted={autoplayEnabled}
        draggable={false}
        height={post.sampleHeight || post.height || undefined}
        onError={onMediaReady}
        onLoadedMetadata={onMediaReady}
        onLoadedData={onMediaReady}
        loop
        poster={getMediaPosterUrl(post) || undefined}
        playsInline
        preload="metadata"
        src={playbackUrl}
        className={`card-media-asset${mediaLoaded ? ' is-loaded' : ''}`}
        width={post.sampleWidth || post.width || undefined}
      />
    )
  }

  const imageUrl = getCardMediaUrl(post)

  if (!imageUrl) {
    return null
  }

  return (
    <img
      alt={post.rawTags || `Post #${post.id}`}
      className={`card-media-asset${mediaLoaded ? ' is-loaded' : ''}`}
      draggable={false}
      height={post.sampleHeight || post.height || undefined}
      loading="lazy"
      onError={onMediaReady}
      onLoad={onMediaReady}
      src={imageUrl}
      width={post.sampleWidth || post.width || undefined}
    />
  )
}

export function PostCard({
  post,
  viewerIndex,
  viewerPosts,
}: {
  post: FeedItem
  viewerIndex: number
  viewerPosts: FeedItem[]
}) {
  const { preferences, savedIds, savePost, unsavePost, recordDownload, recordViewedPost } =
    useAppContext()
  const [showTags, setShowTags] = useState(false)
  const [activeViewerIndex, setActiveViewerIndex] = useState<number | null>(null)
  const [showViewerSwipeHint, setShowViewerSwipeHint] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [likedBurst, setLikedBurst] = useState(false)
  const [holdMenu, setHoldMenu] = useState<HoldMenuState | null>(null)
  const [holdMenuClosing, setHoldMenuClosing] = useState(false)
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const holdTimerRef = useRef<number | null>(null)
  const holdMenuExitTimerRef = useRef<number | null>(null)
  const viewerSwipeHintTimerRef = useRef<number | null>(null)
  const holdMenuRef = useRef<HoldMenuState | null>(null)
  const pressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const suppressTapRef = useRef(false)
  const mediaRef = useRef<HTMLDivElement | null>(null)
  const lastTapRef = useRef(0)
  const saved = savedIds.has(post.id)
  const aspectRatio = (post.sampleHeight || post.height || 1) / (post.sampleWidth || post.width || 1)
  const isLongPost = aspectRatio >= LONG_POST_RATIO
  const isVideoPost = post.mediaType === 'video'
  const viewerPost = activeViewerIndex === null ? null : viewerPosts[activeViewerIndex] ?? null

  useScrollLock(Boolean(holdMenu))

  useEffect(() => {
    setMediaLoaded(false)
  }, [post.id, post.fileUrl, post.previewUrl, post.sampleUrl, post.mediaType])

  useEffect(() => {
    return () => {
      if (holdMenuExitTimerRef.current !== null) {
        window.clearTimeout(holdMenuExitTimerRef.current)
      }
      if (viewerSwipeHintTimerRef.current !== null) {
        window.clearTimeout(viewerSwipeHintTimerRef.current)
      }
    }
  }, [])

  const clearViewerSwipeHintTimer = () => {
    if (viewerSwipeHintTimerRef.current !== null) {
      window.clearTimeout(viewerSwipeHintTimerRef.current)
      viewerSwipeHintTimerRef.current = null
    }
  }

  const updateHoldMenu = (next: HoldMenuState | null) => {
    if (holdMenuExitTimerRef.current !== null) {
      window.clearTimeout(holdMenuExitTimerRef.current)
      holdMenuExitTimerRef.current = null
    }

    if (next) {
      holdMenuRef.current = next
      setHoldMenu(next)
      setHoldMenuClosing(false)
      return
    }

    holdMenuRef.current = null
    if (!holdMenu) {
      setHoldMenuClosing(false)
      return
    }

    setHoldMenuClosing(true)
    holdMenuExitTimerRef.current = window.setTimeout(() => {
      setHoldMenu(null)
      setHoldMenuClosing(false)
      holdMenuExitTimerRef.current = null
    }, HOLD_MENU_EXIT_MS)
  }

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const flashLike = () => {
    setLikedBurst(true)
    window.setTimeout(() => setLikedBurst(false), 420)
  }

  const setLiked = async (
    forceLike = false,
    source: ActionSource = 'default',
  ) => {
    if (saved && !forceLike) {
      await unsavePost(post.id)
      return
    }

    if (!saved) {
      if (source === 'default') {
        triggerHaptic(preferences.hapticsEnabled, 'light')
      }
      await savePost(post)
    }

    flashLike()
  }

  const handleDownload = async (source: ActionSource = 'default') => {
    if (source === 'default') {
      triggerHaptic(preferences.hapticsEnabled, 'nudge')
    }
    await saveMedia(post, preferences.preferShareOnMobile)
    await recordDownload(post)
  }

  const performAction = async (action: HoldAction) => {
    triggerHoldMenuSelectionHaptic(preferences.hapticsEnabled)

    if (action === 'like') {
      await setLiked(false, 'hold-menu')
      return
    }

    if (action === 'tags') {
      setShowTags(true)
      return
    }

    await handleDownload('hold-menu')
  }

  const openViewer = () => {
    setActiveViewerIndex(viewerIndex)
    setShowViewerSwipeHint(true)
    clearViewerSwipeHintTimer()
    viewerSwipeHintTimerRef.current = window.setTimeout(() => {
      setShowViewerSwipeHint(false)
      viewerSwipeHintTimerRef.current = null
    }, VIEWER_SWIPE_HINT_MS)
  }

  const closeViewer = () => {
    clearViewerSwipeHintTimer()
    setShowViewerSwipeHint(false)
    setActiveViewerIndex(null)
  }

  useEffect(() => {
    if (!viewerPost) {
      return
    }

    void recordViewedPost(viewerPost)
  }, [recordViewedPost, viewerPost])

  const beginHoldGesture = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    origin = { x: event.clientX, y: event.clientY },
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    suppressTapRef.current = false

    if (event.pointerType === 'mouse') {
      event.preventDefault()
    }

    const surface = mediaRef.current
    if (!surface) {
      return
    }

    const rect = surface.getBoundingClientRect()
    const actionReach = HOLD_ACTION_SIZE_PX + 28
    const x = clamp(
      origin.x - rect.left,
      actionReach,
      Math.max(actionReach, rect.width - actionReach),
    )
    const y = clamp(
      origin.y - rect.top,
      actionReach + 42,
      Math.max(actionReach + 42, rect.height - HOLD_ACTION_SIZE_PX),
    )

    pressStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }

    safelySetPointerCapture(event.currentTarget, event.pointerId)
    clearHoldTimer()
    holdTimerRef.current = window.setTimeout(() => {
      triggerHoldMenuOpenHaptic(preferences.hapticsEnabled)
      updateHoldMenu({ activeAction: null, x, y })
      holdTimerRef.current = null
    }, HOLD_DELAY_MS)
  }

  const updateActiveAction = (clientX: number, clientY: number, element: HTMLDivElement) => {
    const currentMenu = holdMenuRef.current
    if (!currentMenu) {
      return
    }

    const rect = element.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top

    let activeAction: HoldAction | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const option of MENU_ACTIONS) {
      const actionX = currentMenu.x + option.dx
      const actionY = currentMenu.y + option.dy
      const distance = Math.hypot(localX - actionX, localY - actionY)

      if (distance < HOLD_ACTION_TRIGGER_PX && distance < nearestDistance) {
        activeAction = option.action
        nearestDistance = distance
      }
    }

    if (activeAction !== currentMenu.activeAction) {
      if (activeAction) {
        triggerHoldMenuHoverHaptic(preferences.hapticsEnabled)
      }
      updateHoldMenu({ ...currentMenu, activeAction })
    }
  }

  const handlePressMove = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    const pressStart = pressStartRef.current
    if (!pressStart || pressStart.pointerId !== event.pointerId) {
      return
    }

    const surface = mediaRef.current
    if (!surface) {
      return
    }

    if (holdMenuRef.current) {
      event.preventDefault()
      updateActiveAction(event.clientX, event.clientY, surface)
      return
    }

    if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > HOLD_MOVEMENT_PX) {
      clearHoldTimer()
      suppressTapRef.current = true
    }
  }

  const handlePressCancel = () => {
    clearHoldTimer()
    pressStartRef.current = null
    suppressTapRef.current = true
    updateHoldMenu(null)
  }

  const handlePressRelease = (allowTapAction: boolean) => {
    const currentMenu = holdMenuRef.current
    clearHoldTimer()
    pressStartRef.current = null

    if (currentMenu) {
      const action = currentMenu.activeAction
      updateHoldMenu(null)
      if (action) {
        void performAction(action)
      }
      return
    }

    if (!allowTapAction) {
      suppressTapRef.current = false
      return
    }

    if (suppressTapRef.current) {
      suppressTapRef.current = false
      return
    }

    const now = Date.now()
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      void openViewer()
      return
    }

    lastTapRef.current = now
  }

  return (
    <>
      <article className="feed-card">
        <div
          className={`card-media${isLongPost && !expanded ? ' truncated' : ''}${mediaLoaded ? '' : ' is-media-loading'}`}
          ref={mediaRef}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          onPointerCancel={isVideoPost ? undefined : handlePressCancel}
          onPointerDown={isVideoPost ? undefined : (event) => beginHoldGesture(event)}
          onPointerMove={isVideoPost ? undefined : handlePressMove}
          onPointerUp={isVideoPost ? undefined : () => handlePressRelease(true)}
          role="presentation"
        >
          {!mediaLoaded ? <div aria-hidden="true" className="card-media-skeleton" /> : null}
          {renderMedia(post, preferences.autoplayEnabled, mediaLoaded, () => setMediaLoaded(true))}
          {isVideoPost ? (
            <button
              aria-label="Hold for post actions"
              className="video-menu-trigger"
              onContextMenu={(event) => event.preventDefault()}
              onPointerCancel={handlePressCancel}
              onPointerDown={(event) => {
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                beginHoldGesture(event, {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                })
              }}
              onPointerMove={handlePressMove}
              onPointerUp={(event) => {
                event.stopPropagation()
                handlePressRelease(false)
              }}
              type="button"
            >
              <MoreVertical aria-hidden="true" size={16} />
            </button>
          ) : null}
          {saved ? (
            <div aria-hidden="true" className="liked-chip">
              <Heart fill="currentColor" size={12} />
            </div>
          ) : null}
          <div className={`like-burst${likedBurst ? ' visible' : ''}`}>
            <Heart aria-hidden="true" fill="currentColor" size={42} />
          </div>

          {isLongPost && !expanded ? (
            <button
              aria-label="Expand tall post"
              className="expand-post-button"
              onClick={() => setExpanded(true)}
              onPointerDown={(event) => {
                event.stopPropagation()
                clearHoldTimer()
              }}
              type="button"
            >
              <span>Expand</span>
              <ChevronDown aria-hidden="true" size={18} />
            </button>
          ) : null}

          {holdMenu ? (
            <>
              <HoldMenuGlass
                activeAction={holdMenu.activeAction}
                className={holdMenuClosing ? 'is-closing' : 'is-open'}
                centers={MENU_ACTIONS.map((option) => ({
                  active: holdMenu.activeAction === option.action,
                  x: holdMenu.x + option.dx,
                  y: holdMenu.y + option.dy,
                }))}
              />
              <div
                className={`hold-menu ${holdMenuClosing ? 'is-closing' : 'is-open'}`}
                style={{ left: holdMenu.x, top: holdMenu.y }}
              >
                {MENU_ACTIONS.map((option) => {
                  const Icon = option.icon
                  const active = holdMenu.activeAction === option.action
                  return (
                    <div
                      aria-hidden="true"
                      className={`hold-action${active ? ' active' : ''}`}
                      key={option.action}
                      style={
                        {
                          ['--action-index' as string]: MENU_ACTIONS.findIndex(
                            (entry) => entry.action === option.action,
                          ),
                          ['--offset-x' as string]: `${option.dx}px`,
                          ['--offset-y' as string]: `${option.dy}px`,
                        } as CSSProperties
                      }
                    >
                      <span className="hold-action-shell" />
                      <span className="hold-action-content">
                        <Icon
                          fill={option.action === 'like' && saved ? 'currentColor' : 'none'}
                          size={24}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
      </article>

      {viewerPost ? (
        <PostViewer
          autoplayEnabled={preferences.autoplayEnabled}
          canGoNext={activeViewerIndex !== null && activeViewerIndex < viewerPosts.length - 1}
          canGoPrevious={activeViewerIndex !== null && activeViewerIndex > 0}
          onClose={closeViewer}
          onNext={() =>
            setActiveViewerIndex((current) =>
              current === null ? current : Math.min(current + 1, viewerPosts.length - 1),
            )
          }
          onPrevious={() =>
            setActiveViewerIndex((current) =>
              current === null ? current : Math.max(current - 1, 0),
            )
          }
          post={viewerPost}
          showSwipeHint={showViewerSwipeHint}
        />
      ) : null}
      <TagSheet onClose={() => setShowTags(false)} open={showTags} tags={post.tags} />
    </>
  )
}
