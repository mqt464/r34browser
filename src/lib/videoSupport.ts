function getVideoExtension(url: string) {
  const candidates = [url]

  for (let index = 0; index < candidates.length && index < 3; index += 1) {
    const candidate = candidates[index]
    const cleanUrl = candidate.split(/[?#]/, 1)[0] ?? ''
    const extension = cleanUrl.split('.').pop()?.trim().toLowerCase() ?? ''
    if (['mp4', 'webm', 'mov'].includes(extension)) {
      return extension
    }

    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded !== candidate) {
        candidates.push(decoded)
      }
    } catch {
      // Ignore malformed percent-encoding in proxy URLs.
    }

    const embeddedMatch =
      /(?:^|[/?=&])[^?#=&]+\.(mp4|webm|mov)(?:$|[?#&])/i.exec(candidate) ??
      /\.((?:mp4|webm|mov))(?:$|[?#&])/i.exec(candidate)

    if (embeddedMatch?.[1]) {
      return embeddedMatch[1].toLowerCase()
    }
  }

  return ''
}

function isIosLikeDevice() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(userAgent)
}

export function sortVideoUrlsBySupport(urls: string[]) {
  return [...urls].sort((left, right) => {
    const leftMp4 = getVideoExtension(left) === 'mp4' ? 1 : 0
    const rightMp4 = getVideoExtension(right) === 'mp4' ? 1 : 0
    return rightMp4 - leftMp4
  })
}

export function shouldAvoidInlineVideo(urls: string[]) {
  if (!isIosLikeDevice()) {
    return false
  }

  const hasMp4 = urls.some((url) => getVideoExtension(url) === 'mp4')
  const hasWebm = urls.some((url) => getVideoExtension(url) === 'webm')
  return hasWebm && !hasMp4
}
