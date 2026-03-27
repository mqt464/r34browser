import { useCallback, useEffect, useMemo, useRef, useState, type VideoHTMLAttributes } from 'react'
import { bindSyncedVideoAudio } from '../lib/videoAudio'
import { sortVideoUrlsBySupport } from '../lib/videoSupport'

type SyncedVideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
  debugLabel?: string
  defaultMuted?: boolean
  fallbackSources?: string[]
  loadStrategy?: 'eager' | 'visible'
}

type ReferrerPolicyMode = 'no-referrer' | 'origin-when-cross-origin'

type PlaybackAttempt = {
  referrerPolicy: ReferrerPolicyMode
  src: string
}

const VIEWPORT_PLAYBACK_THRESHOLD = 0.35
const VISIBLE_LOAD_ROOT_MARGIN = '0px'
const VISIBLE_LOAD_THRESHOLD = 0.45
const MAX_CONCURRENT_VISIBLE_LOADS = 2
const VIDEO_LOAD_TIMEOUT_MS = 12000
const visibleLoadOwners = new Set<number>()
const visibleLoadQueue = new Map<number, () => void>()
let nextVisibleLoadOwnerId = 1

function flushVisibleLoadQueue() {
  if (visibleLoadOwners.size >= MAX_CONCURRENT_VISIBLE_LOADS) {
    return
  }

  for (const [ownerId, grant] of visibleLoadQueue) {
    visibleLoadQueue.delete(ownerId)
    visibleLoadOwners.add(ownerId)
    grant()

    if (visibleLoadOwners.size >= MAX_CONCURRENT_VISIBLE_LOADS) {
      return
    }
  }
}

function requestVisibleLoad(ownerId: number, onGrant: () => void) {
  if (visibleLoadOwners.has(ownerId)) {
    onGrant()
    return
  }

  if (visibleLoadOwners.size < MAX_CONCURRENT_VISIBLE_LOADS) {
    visibleLoadOwners.add(ownerId)
    onGrant()
    return
  }

  visibleLoadQueue.set(ownerId, onGrant)
}

function releaseVisibleLoad(ownerId: number) {
  const releasedOwner = visibleLoadOwners.delete(ownerId)
  const removedQueuedOwner = visibleLoadQueue.delete(ownerId)

  if (releasedOwner || removedQueuedOwner) {
    flushVisibleLoadQueue()
  }
}

function prefersRelaxedReferrer(url: string) {
  return /https?:\/\/(?:video-cdn\.)?realbooru\.com\//i.test(url)
}

function logVideoDebug(debugLabel: string | undefined, stage: string, details?: Record<string, unknown>) {
  if (!debugLabel) {
    return
  }

  console.log(`[video-debug:${debugLabel}] ${stage}`, details ?? {})
}

export function SyncedVideo({
  autoPlay = false,
  debugLabel,
  defaultMuted = false,
  fallbackSources = [],
  loadStrategy = 'eager',
  onCanPlay,
  onLoadStart,
  onLoadedData,
  onLoadedMetadata,
  onError,
  onPlaying,
  onProgress,
  src,
  ...props
}: SyncedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const visibleLoadOwnerIdRef = useRef<number>(nextVisibleLoadOwnerId++)
  const pausedByViewportRef = useRef(false)
  const loadedRef = useRef(false)
  const lastLoadActivityAtRef = useRef(0)
  const attemptIndexRef = useRef(0)
  const sources = useMemo(
    () => sortVideoUrlsBySupport([...new Set([src, ...fallbackSources].filter(Boolean) as string[])]),
    [fallbackSources, src],
  )
  const attempts = useMemo<PlaybackAttempt[]>(
    () =>
      sources.flatMap((source) =>
        prefersRelaxedReferrer(source)
          ? [
              { referrerPolicy: 'origin-when-cross-origin' as const, src: source },
              { referrerPolicy: 'no-referrer' as const, src: source },
            ]
          : [
              { referrerPolicy: 'no-referrer' as const, src: source },
              { referrerPolicy: 'origin-when-cross-origin' as const, src: source },
            ],
      ),
    [sources],
  )
  const [attemptIndex, setAttemptIndex] = useState(0)
  const [canLoad, setCanLoad] = useState(false)
  const [isVisibleForLoad, setIsVisibleForLoad] = useState(loadStrategy !== 'visible')
  const lastAttemptIndex = attempts.length - 1
  const activeAttempt = attempts[attemptIndex] ?? null
  const activeSrc = activeAttempt?.src ?? ''
  const activeReferrerPolicy = activeAttempt?.referrerPolicy ?? 'no-referrer'
  const supportsVisibleLoad = typeof IntersectionObserver !== 'undefined'
  const shouldDeferLoad =
    loadStrategy === 'visible' && !autoPlay && !canLoad && supportsVisibleLoad
  const resolvedSrc = shouldDeferLoad ? '' : activeSrc

  const advancePlayback = useCallback(
    (
      reason: string,
      event?: Parameters<NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onError']>>[0],
    ) => {
      const currentAttemptIndex = attemptIndexRef.current
      if (currentAttemptIndex >= lastAttemptIndex) {
        logVideoDebug(debugLabel, 'attempts-exhausted', {
          activeReferrerPolicy,
          activeSrc,
          attemptIndex: currentAttemptIndex,
          reason,
        })
        if (event) {
          onError?.(event)
        }
        return
      }

      const nextAttempt = attempts[currentAttemptIndex + 1] ?? null
      logVideoDebug(debugLabel, 'retrying', {
        activeReferrerPolicy,
        activeSrc,
        attemptIndex: currentAttemptIndex,
        nextAttempt,
        reason,
      })
      setAttemptIndex(currentAttemptIndex + 1)
    },
    [activeReferrerPolicy, activeSrc, attempts, debugLabel, lastAttemptIndex, onError],
  )

  useEffect(() => {
    attemptIndexRef.current = attemptIndex
  }, [attemptIndex])

  useEffect(() => {
    logVideoDebug(debugLabel, 'attempt-plan', {
      attempts,
      autoPlay,
      canLoad,
      loadStrategy,
      sources,
    })
  }, [attempts, autoPlay, canLoad, debugLabel, loadStrategy, sources])

  useEffect(() => {
    if (!shouldDeferLoad) {
      return
    }

    const video = videoRef.current
    if (!video) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextVisibleState =
          entry?.isIntersecting === true &&
          entry.intersectionRatio >= VISIBLE_LOAD_THRESHOLD

        if (nextVisibleState === isVisibleForLoad) {
          return
        }

        logVideoDebug(debugLabel, nextVisibleState ? 'visible-load-armed' : 'visible-load-disarmed', {
          activeReferrerPolicy,
          activeSrc,
          attemptIndex,
        })
        setIsVisibleForLoad(nextVisibleState)
      },
      { rootMargin: VISIBLE_LOAD_ROOT_MARGIN, threshold: [0, VISIBLE_LOAD_THRESHOLD] },
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [
    activeReferrerPolicy,
    activeSrc,
    attemptIndex,
    debugLabel,
    isVisibleForLoad,
    shouldDeferLoad,
  ])

  useEffect(() => {
    const visibleLoadOwnerId = visibleLoadOwnerIdRef.current

    if (!shouldDeferLoad) {
      setCanLoad(true)
      return
    }

    if (!isVisibleForLoad) {
      setCanLoad(false)
      releaseVisibleLoad(visibleLoadOwnerId)
      return
    }

    let cancelled = false
    requestVisibleLoad(visibleLoadOwnerId, () => {
      if (cancelled) {
        releaseVisibleLoad(visibleLoadOwnerId)
        return
      }

      logVideoDebug(debugLabel, 'visible-load-granted', {
        activeReferrerPolicy,
        activeSrc,
        attemptIndex,
      })
      setCanLoad(true)
    })

    return () => {
      cancelled = true
      releaseVisibleLoad(visibleLoadOwnerId)
    }
  }, [
    activeReferrerPolicy,
    activeSrc,
    attemptIndex,
    debugLabel,
    isVisibleForLoad,
    shouldDeferLoad,
  ])

  useEffect(() => {
    const visibleLoadOwnerId = visibleLoadOwnerIdRef.current

    return () => {
      releaseVisibleLoad(visibleLoadOwnerId)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const currentSrc = video.getAttribute('src') ?? ''
    const currentReferrerPolicy = video.getAttribute('referrerpolicy') ?? ''

    const shouldReloadForPolicyChange = currentReferrerPolicy !== activeReferrerPolicy

    if (shouldReloadForPolicyChange) {
      video.setAttribute('referrerpolicy', activeReferrerPolicy)
    }

    if (resolvedSrc && (currentSrc !== resolvedSrc || shouldReloadForPolicyChange)) {
      logVideoDebug(debugLabel, 'apply-source', {
        activeReferrerPolicy,
        activeSrc: resolvedSrc,
        attemptIndex,
        canLoad,
        previousReferrerPolicy: currentReferrerPolicy,
        previousSrc: currentSrc,
        shouldReloadForPolicyChange,
      })
      video.src = resolvedSrc
      video.load()
    } else if (!resolvedSrc && currentSrc) {
      logVideoDebug(debugLabel, shouldDeferLoad ? 'defer-source' : 'clear-source', {
        attemptIndex,
        canLoad,
        currentSrc,
      })
      video.removeAttribute('src')
      video.load()
    }

    return bindSyncedVideoAudio(video, { defaultMuted })
  }, [
    activeReferrerPolicy,
    attemptIndex,
    canLoad,
    debugLabel,
    defaultMuted,
    resolvedSrc,
    shouldDeferLoad,
  ])

  useEffect(() => {
    pausedByViewportRef.current = false
    loadedRef.current = false
    lastLoadActivityAtRef.current = Date.now()
  }, [activeReferrerPolicy, resolvedSrc])

  useEffect(() => {
    if (!resolvedSrc) {
      return
    }

    let timeoutId = 0
    let cancelled = false

    const scheduleLoadCheck = () => {
      const idleForMs = Date.now() - lastLoadActivityAtRef.current
      const delay = Math.max(VIDEO_LOAD_TIMEOUT_MS - idleForMs, 0)

      timeoutId = window.setTimeout(() => {
        if (cancelled || loadedRef.current) {
          return
        }

        const video = videoRef.current
        if (!video) {
          return
        }

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          loadedRef.current = true
          return
        }

        const stalledForMs = Date.now() - lastLoadActivityAtRef.current
        if (stalledForMs < VIDEO_LOAD_TIMEOUT_MS) {
          scheduleLoadCheck()
          return
        }

        logVideoDebug(debugLabel, 'stalled-timeout', {
          activeReferrerPolicy,
          activeSrc: resolvedSrc,
          attemptIndex,
          readyState: video.readyState,
          stalledForMs,
        })
        advancePlayback(
          'stalled-timeout',
          new Event('error') as unknown as React.SyntheticEvent<HTMLVideoElement, Event>,
        )
      }, delay)
    }

    scheduleLoadCheck()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [
    resolvedSrc,
    activeReferrerPolicy,
    advancePlayback,
    attemptIndex,
    debugLabel,
  ])

  const markLoadActivity = useCallback(() => {
    lastLoadActivityAtRef.current = Date.now()
  }, [])

  const handleCanPlay: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onCanPlay']> = (
    event,
  ) => {
    loadedRef.current = true
    markLoadActivity()
    logVideoDebug(debugLabel, 'canplay', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      readyState: event.currentTarget.readyState,
    })
    onCanPlay?.(event)
  }

  const handleLoadStart: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onLoadStart']> = (
    event,
  ) => {
    markLoadActivity()
    logVideoDebug(debugLabel, 'loadstart', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      networkState: event.currentTarget.networkState,
    })
    onLoadStart?.(event)
  }

  const handleProgress: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onProgress']> = (
    event,
  ) => {
    markLoadActivity()
    logVideoDebug(debugLabel, 'progress', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      buffered: event.currentTarget.buffered.length,
      readyState: event.currentTarget.readyState,
    })
    onProgress?.(event)
  }

  const handlePlaying: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onPlaying']> = (
    event,
  ) => {
    loadedRef.current = true
    markLoadActivity()
    logVideoDebug(debugLabel, 'playing', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      currentTime: event.currentTarget.currentTime,
    })
    onPlaying?.(event)
  }

  const handleLoadedMetadata: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onLoadedMetadata']> = (
    event,
  ) => {
    loadedRef.current = true
    markLoadActivity()
    logVideoDebug(debugLabel, 'loadedmetadata', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      duration: event.currentTarget.duration,
      height: event.currentTarget.videoHeight,
      width: event.currentTarget.videoWidth,
    })
    onLoadedMetadata?.(event)
  }

  const handleLoadedData: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onLoadedData']> = (
    event,
  ) => {
    loadedRef.current = true
    markLoadActivity()
    logVideoDebug(debugLabel, 'loadeddata', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      readyState: event.currentTarget.readyState,
    })
    onLoadedData?.(event)
  }

  const handleError: NonNullable<VideoHTMLAttributes<HTMLVideoElement>['onError']> = (event) => {
    logVideoDebug(debugLabel, 'error', {
      activeReferrerPolicy,
      activeSrc,
      attemptIndex,
      mediaErrorCode: event.currentTarget.error?.code ?? null,
      mediaErrorMessage: event.currentTarget.error?.message ?? null,
      networkState: event.currentTarget.networkState,
      readyState: event.currentTarget.readyState,
    })
    advancePlayback('media-error', event)
  }

  useEffect(() => {
    if (!autoPlay) {
      return
    }

    markLoadActivity()
  }, [autoPlay, markLoadActivity])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const handleSeekingLikeEvent = () => {
      markLoadActivity()
    }

    video.addEventListener('play', handleSeekingLikeEvent)
    video.addEventListener('seeking', handleSeekingLikeEvent)

    return () => {
      video.removeEventListener('play', handleSeekingLikeEvent)
      video.removeEventListener('seeking', handleSeekingLikeEvent)
    }
  }, [resolvedSrc, markLoadActivity])

  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible =
          entry?.isIntersecting === true &&
          entry.intersectionRatio >= VIEWPORT_PLAYBACK_THRESHOLD

        if (!isVisible) {
          if (!video.paused && !video.ended) {
            pausedByViewportRef.current = true
            video.pause()
          }

          return
        }

        if (!autoPlay || !pausedByViewportRef.current) {
          return
        }

        pausedByViewportRef.current = false
        void video.play().catch(() => {
          pausedByViewportRef.current = true
        })
      },
      { threshold: [0, VIEWPORT_PLAYBACK_THRESHOLD] },
    )

    observer.observe(video)

    return () => {
      observer.disconnect()
    }
  }, [resolvedSrc, autoPlay])

  return (
    <video
      {...props}
      autoPlay={autoPlay}
      onCanPlay={handleCanPlay}
      onLoadStart={handleLoadStart}
      muted={defaultMuted}
      onLoadedData={handleLoadedData}
      onLoadedMetadata={handleLoadedMetadata}
      onError={handleError}
      onPlaying={handlePlaying}
      onProgress={handleProgress}
      ref={videoRef}
    />
  )
}
