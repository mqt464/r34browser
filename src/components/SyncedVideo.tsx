import { useEffect, useRef, type VideoHTMLAttributes } from 'react'
import { bindSyncedVideoAudio } from '../lib/videoAudio'

type SyncedVideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
  defaultMuted?: boolean
}

export function SyncedVideo({ defaultMuted = false, ...props }: SyncedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    return bindSyncedVideoAudio(video, { defaultMuted })
  }, [defaultMuted, props.src])

  return <video {...props} muted={defaultMuted} ref={videoRef} />
}
