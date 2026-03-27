import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../hooks/useScrollLock'
import { enrichRealbooruPost, needsRealbooruMediaEnrichment } from '../lib/api'
import {
  getDetailMediaUrl,
  getMediaPosterUrl,
  getVideoPlaybackCandidates,
  getVideoPlaybackStateKey,
} from '../lib/media'
import { shouldAvoidInlineVideo } from '../lib/videoSupport'
import { SyncedVideo } from './SyncedVideo'
import type { FeedItem } from '../types'

const SWIPE_TRIGGER_PX = 80
const SWIPE_LOCK_PX = 14
const SWIPE_LIMIT_PX = 140

function ViewerMedia({
  autoplayEnabled,
  onVideoFailed,
  post,
  videoFailed,
}: {
  autoplayEnabled: boolean
  onVideoFailed: () => void
  post: FeedItem
  videoFailed: boolean
}) {
  const videoCandidates = post.mediaType === 'video' ? getVideoPlaybackCandidates(post) : []
  const videoPlaybackStateKey =
    post.mediaType === 'video' ? getVideoPlaybackStateKey(post) : post.storageKey

  if (post.mediaType === 'video' && (videoFailed || shouldAvoidInlineVideo(videoCandidates))) {
    if (post.source === 'realbooru') {
      console.log(`[video-debug:viewer:${post.id}] render-image-fallback`, {
        poster: getMediaPosterUrl(post) || post.previewUrl,
        videoCandidates,
        videoFailed,
      })
    }
    const imageUrl = getMediaPosterUrl(post) || post.previewUrl
    const fallbackUrl = post.fileUrl || videoCandidates[0] || ''

    if (!imageUrl) {
      return null
    }

    return (
      <button
        aria-label="Open video in a new tab"
        className="viewer-video-fallback"
        onClick={() => {
          if (fallbackUrl) {
            window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
          }
        }}
        type="button"
      >
        <img alt={post.rawTags || `Post #${post.id}`} referrerPolicy="no-referrer" src={imageUrl} />
        <span>Open video</span>
      </button>
    )
  }

  if (post.mediaType === 'video') {
    const playbackUrl = getDetailMediaUrl(post)

    if (!playbackUrl) {
      if (post.source === 'realbooru') {
        console.log(`[video-debug:viewer:${post.id}] missing-playback-url`, {
          post,
          videoCandidates,
        })
      }
      return null
    }

    if (post.source === 'realbooru') {
      console.log(`[video-debug:viewer:${post.id}] render-video`, {
        playbackUrl,
        videoCandidates,
      })
    }

    return (
      <SyncedVideo
        autoPlay={autoplayEnabled}
        controls
        defaultMuted={false}
        debugLabel={post.source === 'realbooru' ? `viewer:${post.id}` : undefined}
        fallbackSources={videoCandidates}
        key={videoPlaybackStateKey}
        loop
        onError={onVideoFailed}
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

  return <img alt={post.rawTags || `Post #${post.id}`} referrerPolicy="no-referrer" src={imageUrl} />
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
  const [resolvedPost, setResolvedPost] = useState<FeedItem | null>(null)
  const [failedPlaybackKey, setFailedPlaybackKey] = useState('')
  const videoRecoveryAttemptedRef = useRef(false)
  const displayPost = resolvedPost ?? post
  const videoPlaybackStateKey = useMemo(
    () => (displayPost.mediaType === 'video' ? getVideoPlaybackStateKey(displayPost) : ''),
    [displayPost],
  )
  const videoFailed = failedPlaybackKey === videoPlaybackStateKey

  useScrollLock(true)

  useEffect(() => {
    videoRecoveryAttemptedRef.current = false
  }, [post, videoPlaybackStateKey])

  useEffect(() => {
    if (!needsRealbooruMediaEnrichment(post)) {
      return
    }

    let cancelled = false
    void enrichRealbooruPost(post)
      .then((nextPost) => {
        if (!cancelled) {
          setResolvedPost(nextPost)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [post])

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

  const handleVideoFailure = useCallback(() => {
    if (displayPost.source === 'realbooru') {
      console.log(`[video-debug:viewer:${displayPost.id}] handleVideoFailure`, {
        mediaResolved: displayPost.mediaResolved,
        playbackUrl: getDetailMediaUrl(displayPost),
        videoCandidates: getVideoPlaybackCandidates(displayPost),
      })
    }

    if (
      displayPost.source === 'realbooru' &&
      displayPost.mediaType === 'video' &&
      displayPost.mediaResolved !== true &&
      !videoRecoveryAttemptedRef.current
    ) {
      videoRecoveryAttemptedRef.current = true
      void enrichRealbooruPost(displayPost)
        .then((nextPost) => {
          setResolvedPost(nextPost)
        })
        .catch(() => {
          setFailedPlaybackKey(videoPlaybackStateKey)
        })
      return
    }

    setFailedPlaybackKey(videoPlaybackStateKey)
  }, [displayPost, videoPlaybackStateKey])

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
            <ViewerMedia
              autoplayEnabled={autoplayEnabled}
              onVideoFailed={handleVideoFailure}
              post={displayPost}
              videoFailed={videoFailed}
            />
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
