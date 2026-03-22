import type { FeedItem } from '../types'

type HapticStep = {
  delay?: number
  duration: number
  intensity?: number
}

type HapticPreset =
  | 'success'
  | 'warning'
  | 'error'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'soft'
  | 'rigid'
  | 'selection'
  | 'nudge'
  | 'buzz'

type HapticInput = number | HapticPreset | number[] | HapticStep[] | { pattern: HapticStep[] }

const DEFAULT_PATTERNS: Record<HapticPreset, HapticStep[]> = {
  success: [
    { duration: 30, intensity: 0.5 },
    { delay: 60, duration: 40, intensity: 1 },
  ],
  warning: [
    { duration: 40, intensity: 0.8 },
    { delay: 100, duration: 40, intensity: 0.6 },
  ],
  error: [
    { duration: 40, intensity: 0.9 },
    { delay: 40, duration: 40, intensity: 0.9 },
    { delay: 40, duration: 40, intensity: 0.9 },
  ],
  light: [{ duration: 15, intensity: 0.4 }],
  medium: [{ duration: 25, intensity: 0.7 }],
  heavy: [{ duration: 35, intensity: 1 }],
  soft: [{ duration: 40, intensity: 0.5 }],
  rigid: [{ duration: 10, intensity: 1 }],
  selection: [{ duration: 8, intensity: 0.3 }],
  nudge: [
    { duration: 80, intensity: 0.8 },
    { delay: 80, duration: 50, intensity: 0.3 },
  ],
  buzz: [{ duration: 1000, intensity: 1 }],
}

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function isFiniteDuration(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normaliseHapticSteps(input: HapticInput): HapticStep[] {
  if (typeof input === 'number') {
    return isFiniteDuration(input) ? [{ duration: input }] : []
  }

  if (typeof input === 'string') {
    return DEFAULT_PATTERNS[input]?.map((step) => ({ ...step })) ?? DEFAULT_PATTERNS.medium
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return []
    }

    if (typeof input[0] === 'number') {
      const numericPattern = input as number[]
      const steps: HapticStep[] = []

      for (let index = 0; index < numericPattern.length; index += 2) {
        const duration = numericPattern[index]
        if (!isFiniteDuration(duration)) {
          continue
        }

        const delay = index > 0 ? numericPattern[index - 1] : 0
        steps.push(delay > 0 ? { delay, duration } : { duration })
      }

      return steps
    }

    return (input as HapticStep[])
      .filter((step) => isFiniteDuration(step.duration))
      .map((step) => ({
        delay: step.delay && step.delay > 0 ? step.delay : undefined,
        duration: step.duration,
        intensity:
          typeof step.intensity === 'number' && Number.isFinite(step.intensity)
            ? clamp(step.intensity, 0, 1)
            : undefined,
      }))
  }

  return normaliseHapticSteps(input.pattern)
}

function buildVibrationPattern(steps: HapticStep[]) {
  const pattern: number[] = []

  for (const step of steps) {
    const delay = step.delay ?? 0

    if (delay > 0) {
      if (pattern.length === 0) {
        pattern.push(0, delay)
      } else if (pattern.length % 2 === 0) {
        pattern[pattern.length - 1] += delay
      } else {
        pattern.push(delay)
      }
    }

    pattern.push(step.duration)
  }

  return pattern
}

function isIosTouchDevice() {
  const platform =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  return platform && window.matchMedia('(pointer: coarse)').matches
}

class IosSwitchHaptics {
  private elementId = `r34browser-haptic-${Math.random().toString(36).slice(2)}`
  private label: HTMLLabelElement | null = null
  private timeouts = new Set<number>()

  cancel() {
    for (const timeoutId of this.timeouts) {
      window.clearTimeout(timeoutId)
    }

    this.timeouts.clear()
  }

  trigger(steps: HapticStep[]) {
    if (steps.length === 0) {
      return
    }

    this.cancel()

    let elapsed = 0
    for (const step of steps) {
      elapsed += step.delay ?? 0
      this.scheduleTick(elapsed)
      elapsed += step.duration
    }
  }

  private ensureElement() {
    if (this.label?.isConnected) {
      return
    }

    const label = document.createElement('label')
    label.htmlFor = this.elementId
    label.ariaHidden = 'true'
    label.style.position = 'fixed'
    label.style.width = '1px'
    label.style.height = '1px'
    label.style.overflow = 'hidden'
    label.style.opacity = '0'
    label.style.inset = '-100px auto auto -100px'

    const input = document.createElement('input')
    input.id = this.elementId
    input.type = 'checkbox'
    input.tabIndex = -1
    input.setAttribute('switch', '')
    label.appendChild(input)

    document.body.appendChild(label)
    this.label = label
  }

  private scheduleTick(delay: number) {
    if (delay <= 0) {
      this.tick()
      return
    }

    const timeoutId = window.setTimeout(() => {
      this.timeouts.delete(timeoutId)
      this.tick()
    }, delay)

    this.timeouts.add(timeoutId)
  }

  private tick() {
    this.ensureElement()
    this.label?.click()
  }
}

const iosSwitchHaptics = new IosSwitchHaptics()

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

  const steps = normaliseHapticSteps(pattern)
  if (steps.length === 0) {
    return
  }

  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(buildVibrationPattern(steps))
    return
  }

  if (isIosTouchDevice()) {
    iosSwitchHaptics.trigger(steps)
  }
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
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function supportsDownloadLinks() {
  return typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype
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

async function shareMediaUrl(post: FeedItem) {
  if (typeof navigator.share !== 'function') {
    return false
  }

  await navigator.share({
    title: createDownloadName(post),
    url: post.fileUrl,
  })

  return true
}

export async function saveMedia(post: FeedItem, preferShareOnMobile: boolean) {
  const mobile = isMobileDevice()
  const shouldPreferShare = mobile && preferShareOnMobile

  if (!shouldPreferShare && supportsDownloadLinks()) {
    startDownload(post.fileUrl, createDownloadName(post))
    return 'downloaded'
  }

  if (shouldPreferShare) {
    try {
      const shared = await shareMediaUrl(post)
      if (shared) {
        return 'shared'
      }
    } catch {
      // Fall through to file share or direct download.
    }

    try {
      const shared = await shareFile(post)
      if (shared) {
        return 'shared'
      }
    } catch {
      // Direct download fallback is intentional here.
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
