const registeredVideos = new Set<HTMLVideoElement>()

let syncLocked = false
let audioState = {
  initialized: false,
  muted: false,
  volume: 1,
}

function normalizeVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.min(Math.max(value, 0), 1)
}

function applyAudioState(video: HTMLVideoElement) {
  syncLocked = true
  video.muted = audioState.muted
  video.defaultMuted = audioState.muted
  video.volume = normalizeVolume(audioState.volume)
  syncLocked = false
}

function syncAllVideos(origin?: HTMLVideoElement) {
  registeredVideos.forEach((video) => {
    if (video !== origin) {
      applyAudioState(video)
    }
  })
}

export function bindSyncedVideoAudio(
  video: HTMLVideoElement,
  options?: { defaultMuted?: boolean },
) {
  if (!audioState.initialized) {
    audioState = {
      initialized: true,
      muted: options?.defaultMuted ?? video.muted,
      volume: normalizeVolume(video.volume),
    }
  }

  registeredVideos.add(video)
  applyAudioState(video)

  const handleVolumeChange = () => {
    if (syncLocked) {
      return
    }

    audioState = {
      initialized: true,
      muted: video.muted,
      volume: normalizeVolume(video.volume),
    }
    syncAllVideos(video)
  }

  const handleLoadedMetadata = () => {
    applyAudioState(video)
  }

  video.addEventListener('loadedmetadata', handleLoadedMetadata)
  video.addEventListener('volumechange', handleVolumeChange)

  return () => {
    registeredVideos.delete(video)
    video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    video.removeEventListener('volumechange', handleVolumeChange)
  }
}
