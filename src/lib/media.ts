import type { FeedItem } from '../types'

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov'])
const GIF_EXTENSIONS = new Set(['gif'])

function trimExtension(value?: string) {
  return value?.trim().toLowerCase().replace(/^\./, '') ?? ''
}

function getUrlExtension(url: string) {
  const [pathname] = url.split(/[?#]/, 1)
  const segments = pathname.split('.')
  return trimExtension(segments.pop())
}

function nonEmptyUrls(urls: Array<string | undefined>) {
  return urls.filter((url): url is string => Boolean(url && url.trim()))
}

export function inferMediaType(url: string, fileExt?: string): FeedItem['mediaType'] {
  const normalizedExtension = trimExtension(fileExt) || getUrlExtension(url)

  if (VIDEO_EXTENSIONS.has(normalizedExtension)) {
    return 'video'
  }

  if (GIF_EXTENSIONS.has(normalizedExtension)) {
    return 'gif'
  }

  return 'image'
}

export function getStillImageUrl(post: Pick<FeedItem, 'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl'>) {
  const candidates = [
    { url: post.sampleUrl, fileExt: undefined },
    { url: post.previewUrl, fileExt: undefined },
    { url: post.fileUrl, fileExt: post.fileExt },
  ]

  return (
    candidates.find(
      (candidate) =>
        candidate.url && inferMediaType(candidate.url, candidate.fileExt) !== 'video',
    )?.url ?? ''
  )
}

export function getVideoPlaybackUrl(
  post: Pick<FeedItem, 'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl'>,
) {
  if (post.fileUrl && inferMediaType(post.fileUrl, post.fileExt) === 'video') {
    return post.fileUrl
  }

  return (
    nonEmptyUrls([post.sampleUrl, post.previewUrl]).find(
      (url) => inferMediaType(url) === 'video',
    ) ?? ''
  )
}

export function getCardMediaUrl(post: FeedItem) {
  if (post.mediaType === 'video') {
    return getVideoPlaybackUrl(post)
  }

  return nonEmptyUrls([post.sampleUrl, post.fileUrl, post.previewUrl])[0] ?? ''
}

export function getDetailMediaUrl(post: FeedItem) {
  if (post.mediaType === 'video') {
    return getVideoPlaybackUrl(post)
  }

  return nonEmptyUrls([post.fileUrl, post.sampleUrl, post.previewUrl])[0] ?? ''
}

export function getMediaPosterUrl(post: FeedItem) {
  if (post.mediaType !== 'video') {
    return ''
  }

  return getStillImageUrl(post)
}

export function getPreloadImageUrl(post: FeedItem) {
  return getStillImageUrl(post) || nonEmptyUrls([post.previewUrl, post.sampleUrl])[0] || ''
}
