import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../hooks/useScrollLock'
import { getDetailMediaUrl, getMediaPosterUrl } from '../lib/media'
import type { FeedItem } from '../types'

const SWIPE_TRIGGER_PX = 80
const SWIPE_LOCK_PX = 14
const SWIPE_LIMIT_PX = 140

function renderViewerMedia(post: FeedItem, autoplayEnabled: boolean) {
  if (post.mediaType === 'video') {
    const playbackUrl = getDetailMediaUrl(post)

    if (!playbackUrl) {
      return null
    }

    return (
      <video
        autoPlay={autoplayEnabled}
        controls
        loop
        muted={false}
        poster={getMediaPosterUrl(post) || undefined}
        playsInline
        src={playbackUrl}
      />
    )
  }

  const imageUrl = getDetailMediaUrl(post)

  if (!imageUrl) {
    return null
  }

  return <img alt={post.rawTags || `Post #${post.id}`} src={imageUrl} />
}

export function PostViewer({
  autoplayEnabled,
  canGoNext = false,
  canGoPrevious = false,
  onClose,
  onNext,
  onPrevious,
  post,
  showSwipeHint = false,
}: {
  autoplayEnabled: boolean
  canGoNext?: boolean
  canGoPrevious?: boolean
  onClose: () => void
  onNext?: () => void
  onPrevious?: () => void
  post: FeedItem
  showSwipeHint?: boolean
}) {
  const pointerStateRef = useRef<{
    active: boolean
    id: number
    startX: number
    startY: number
    swiping: boolean
  } | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)

  useScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === 'ArrowLeft' && canGoPrevious) {
        onPrevious?.()
        return
      }

      if (event.key === 'ArrowRight' && canGoNext) {
        onNext?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canGoNext, canGoPrevious, onClose, onNext, onPrevious])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="viewer-backdrop" onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className="viewer-shell"
        onClick={(event) => event.stopPropagation()}
        onPointerCancel={() => {
          pointerStateRef.current = null
          setSwipeOffset(0)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return
          }

          pointerStateRef.current = {
            active: true,
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            swiping: false,
          }
        }}
        onPointerMove={(event) => {
          const pointerState = pointerStateRef.current
          if (!pointerState?.active || pointerState.id !== event.pointerId) {
            return
          }

          const deltaX = event.clientX - pointerState.startX
          const deltaY = event.clientY - pointerState.startY

          if (!pointerState.swiping) {
            if (Math.abs(deltaX) < SWIPE_LOCK_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
              return
            }

            pointerStateRef.current = {
              ...pointerState,
              swiping: true,
            }
          }

          event.preventDefault()
          const nextOffset = Math.min(Math.max(deltaX, -SWIPE_LIMIT_PX), SWIPE_LIMIT_PX)
          setSwipeOffset(nextOffset)
        }}
        onPointerUp={(event) => {
          const pointerState = pointerStateRef.current
          if (!pointerState?.active || pointerState.id !== event.pointerId) {
            return
          }

          const deltaX = event.clientX - pointerState.startX
          pointerStateRef.current = null

          if (pointerState.swiping) {
            if (deltaX <= -SWIPE_TRIGGER_PX && canGoNext) {
              setSwipeOffset(0)
              onNext?.()
              return
            }

            if (deltaX >= SWIPE_TRIGGER_PX && canGoPrevious) {
              setSwipeOffset(0)
              onPrevious?.()
              return
            }
          }

          setSwipeOffset(0)
        }}
        role="dialog"
      >
        {canGoPrevious ? (
          <button
            aria-label="Previous post"
            className="viewer-nav viewer-nav-previous"
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={20} />
          </button>
        ) : null}

        {canGoNext ? (
          <button
            aria-label="Next post"
            className="viewer-nav viewer-nav-next"
            onClick={onNext}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        ) : null}

        <button
          aria-label="Close viewer"
          className="viewer-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>

        <div className="viewer-media">
          <div
            className="viewer-media-frame"
            style={{
              transform: `translate3d(${swipeOffset}px, 0, 0)`,
            }}
          >
            {renderViewerMedia(post, autoplayEnabled)}
          </div>
          {showSwipeHint && (canGoPrevious || canGoNext) && Math.abs(swipeOffset) < 12 ? (
            <div className="viewer-swipe-hint">
              <span>Swipe to browse posts</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
