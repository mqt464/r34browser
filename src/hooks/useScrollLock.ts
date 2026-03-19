import { useEffect, useRef, type RefObject } from 'react'

interface ScrollLockOptions {
  allowScrollRef?: RefObject<HTMLElement | null>
}

interface ActiveScrollLock {
  allowScrollRef?: RefObject<HTMLElement | null>
}

interface StyleSnapshot {
  overflow: string
  position: string
  top: string
  left: string
  right: string
  width: string
}

const activeLocks = new Map<number, ActiveScrollLock>()
let nextLockId = 0
let lockedScrollX = 0
let lockedScrollY = 0
let bodyStyleSnapshot: StyleSnapshot | null = null
let htmlOverflowSnapshot: string | null = null
let listenersAttached = false

function isAllowedScrollTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return false
  }

  for (const lock of activeLocks.values()) {
    const allowedElement = lock.allowScrollRef?.current
    if (allowedElement?.contains(target)) {
      return true
    }
  }

  return false
}

function preventLockedScroll(event: TouchEvent | WheelEvent) {
  if (activeLocks.size === 0) {
    return
  }

  if ('touches' in event && event.touches.length > 1) {
    return
  }

  if (isAllowedScrollTarget(event.target)) {
    return
  }

  event.preventDefault()
}

function attachScrollBlockers() {
  if (listenersAttached || typeof document === 'undefined') {
    return
  }

  document.addEventListener('touchmove', preventLockedScroll, {
    capture: true,
    passive: false,
  })
  document.addEventListener('wheel', preventLockedScroll, {
    capture: true,
    passive: false,
  })
  listenersAttached = true
}

function detachScrollBlockers() {
  if (!listenersAttached || typeof document === 'undefined') {
    return
  }

  document.removeEventListener('touchmove', preventLockedScroll, true)
  document.removeEventListener('wheel', preventLockedScroll, true)
  listenersAttached = false
}

function lockDocumentScroll() {
  if (typeof document === 'undefined' || bodyStyleSnapshot) {
    return
  }

  const { body, documentElement } = document
  lockedScrollX = window.scrollX
  lockedScrollY = window.scrollY
  bodyStyleSnapshot = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  }
  htmlOverflowSnapshot = documentElement.style.overflow

  body.classList.add('no-scroll')
  documentElement.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${lockedScrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
}

function unlockDocumentScroll() {
  if (typeof document === 'undefined' || !bodyStyleSnapshot) {
    return
  }

  const { body, documentElement } = document
  const snapshot = bodyStyleSnapshot

  body.classList.remove('no-scroll')
  body.style.overflow = snapshot.overflow
  body.style.position = snapshot.position
  body.style.top = snapshot.top
  body.style.left = snapshot.left
  body.style.right = snapshot.right
  body.style.width = snapshot.width
  documentElement.style.overflow = htmlOverflowSnapshot ?? ''

  bodyStyleSnapshot = null
  htmlOverflowSnapshot = null
  window.scrollTo(lockedScrollX, lockedScrollY)
}

export function useScrollLock(locked: boolean, options: ScrollLockOptions = {}) {
  const { allowScrollRef } = options
  const lockIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!locked) {
      return
    }

    const lockId = ++nextLockId
    lockIdRef.current = lockId
    activeLocks.set(lockId, { allowScrollRef })

    if (activeLocks.size === 1) {
      lockDocumentScroll()
      attachScrollBlockers()
    }

    return () => {
      const currentLockId = lockIdRef.current
      if (currentLockId === null) {
        return
      }

      activeLocks.delete(currentLockId)
      lockIdRef.current = null

      if (activeLocks.size === 0) {
        detachScrollBlockers()
        unlockDocumentScroll()
      }
    }
  }, [allowScrollRef, locked])
}
