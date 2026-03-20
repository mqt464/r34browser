import { useEffect, useRef, type VideoHTMLAttributes } from 'react'
import { bindSyncedVideoAudio } from '../lib/videoAudio'

type SyncedVideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
  defaultMuted?: boolean
}

const VIEWPORT_PLAYBACK_THRESHOLD = 0.35

export function SyncedVideo({ autoPlay = false, defaultMuted = false, ...props }: SyncedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pausedByViewportRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    return bindSyncedVideoAudio(video, { defaultMuted })
  }, [defaultMuted, props.src])

  useEffect(() => {
    pausedByViewportRef.current = false
  }, [props.src])

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
  }, [autoPlay, props.src])

  return <video {...props} autoPlay={autoPlay} muted={defaultMuted} ref={videoRef} />
}
