import { WebHaptics, type HapticInput } from 'web-haptics'
import type { FeedItem } from '../types'

const webHaptics = new WebHaptics()

const HOLD_MENU_OPEN_HAPTIC: HapticInput = [{ duration: 8, intensity: 0.12 }]
const HOLD_MENU_HOVER_HAPTIC: HapticInput = [{ duration: 10, intensity: 0.22 }]
const HOLD_MENU_SELECT_HAPTIC: HapticInput = [{ duration: 16, intensity: 0.52 }]
const SEARCH_TOKEN_SWAP_HAPTIC: HapticInput = [
  { duration: 8, intensity: 0.18 },
  { duration: 12, intensity: 0.34 },
]
const SCROLL_RESET_HINT_HAPTIC: HapticInput = [{ duration: 8, intensity: 0.14 }]
const SCROLL_RESET_READY_HAPTIC: HapticInput = [
  { duration: 8, intensity: 0.2 },
  { duration: 12, intensity: 0.16 },
]
const SCROLL_RESET_TRIGGER_HAPTIC: HapticInput = [
  { duration: 10, intensity: 0.22 },
  { duration: 18, intensity: 0.5 },
  { duration: 12, intensity: 0.2 },
]

export function isMobileDevice() {
  return (
    window.matchMedia('(max-width: 800px)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  )
}

export function triggerHaptic(enabled: boolean, pattern: HapticInput = 'light') {
  if (!enabled) {
    return
  }

  void webHaptics.trigger(pattern)
}

export function triggerHoldMenuOpenHaptic(enabled: boolean) {
  triggerHaptic(enabled, HOLD_MENU_OPEN_HAPTIC)
}

export function triggerHoldMenuHoverHaptic(enabled: boolean) {
  triggerHaptic(enabled, HOLD_MENU_HOVER_HAPTIC)
}

export function triggerHoldMenuSelectionHaptic(enabled: boolean) {
  triggerHaptic(enabled, HOLD_MENU_SELECT_HAPTIC)
}

export function triggerSearchTokenSwapHaptic(enabled: boolean) {
  triggerHaptic(enabled, SEARCH_TOKEN_SWAP_HAPTIC)
}

export function triggerScrollResetHintHaptic(enabled: boolean) {
  triggerHaptic(enabled, SCROLL_RESET_HINT_HAPTIC)
}

export function triggerScrollResetReadyHaptic(enabled: boolean) {
  triggerHaptic(enabled, SCROLL_RESET_READY_HAPTIC)
}

export function triggerScrollResetTriggerHaptic(enabled: boolean) {
  triggerHaptic(enabled, SCROLL_RESET_TRIGGER_HAPTIC)
}

function createDownloadName(post: FeedItem) {
  const extension = post.fileUrl.split('.').pop()?.split('?')[0] ?? 'jpg'
  return `r34-${post.id}.${extension}`
}

function startDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noreferrer'
  anchor.target = '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function shareFile(post: FeedItem) {
  if (
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) {
    return false
  }

  const response = await fetch(post.fileUrl)
  if (!response.ok) {
    return false
  }

  const blob = await response.blob()
  const file = new File([blob], createDownloadName(post), {
    type: blob.type || 'application/octet-stream',
  })

  if (!navigator.canShare({ files: [file] })) {
    return false
  }

  await navigator.share({
    title: `Post #${post.id}`,
    files: [file],
  })
  return true
}

export async function saveMedia(post: FeedItem, preferShareOnMobile: boolean) {
  const mobile = isMobileDevice()

  if (mobile && preferShareOnMobile) {
    try {
      const shared = await shareFile(post)
      if (shared) {
        return 'shared'
      }
    } catch {
      // Download fallback is intentional here.
    }
  }

  startDownload(post.fileUrl, createDownloadName(post))
  return 'downloaded'
}

export async function sharePost(post: FeedItem) {
  const shareUrl = `${window.location.origin}${window.location.pathname}#/post/${post.id}`

  if (typeof navigator.share === 'function') {
    await navigator.share({
      title: `Post #${post.id}`,
      text: post.rawTags,
      url: shareUrl,
    })
    return
  }

  await navigator.clipboard.writeText(shareUrl)
}
