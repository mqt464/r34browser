import type { FeedItem } from '../types'
import { buildProxiedUrl, shouldProxyRealbooruMedia } from './realbooruProxy'

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

function isRealbooruMediaUrl(url: string) {
  return /https?:\/\/(?:video-cdn\.)?realbooru\.com\//i.test(url)
}

function isUnresolvedRealbooruPost(post: Pick<FeedItem, 'mediaResolved' | 'source'>) {
  return post.source === 'realbooru' && post.mediaResolved !== true
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

export function getStillImageUrl(
  post: Pick<FeedItem, 'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl'>,
) {
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

export function getVideoPlaybackCandidates(
  post: Pick<
    FeedItem,
    'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl' | 'source' | 'videoCandidates'
  >,
) {
  const candidateUrls = nonEmptyUrls(post.videoCandidates ?? []).filter(
    (url) => inferMediaType(url) === 'video',
  )

  const primaryUrl =
    post.fileUrl && inferMediaType(post.fileUrl, post.fileExt) === 'video' ? post.fileUrl : ''
  const fallbackUrls = nonEmptyUrls([post.sampleUrl, post.previewUrl]).filter(
    (url) => inferMediaType(url) === 'video',
  )

  const directUrls = [...new Set(nonEmptyUrls([primaryUrl, ...candidateUrls, ...fallbackUrls]))]

  if (post.source !== 'realbooru') {
    return directUrls
  }

  if (!shouldProxyRealbooruMedia()) {
    return directUrls
  }

  const proxiedUrls = directUrls
    .filter((url) => isRealbooruMediaUrl(url))
    .map((url) => buildProxiedUrl(url))

  return [...new Set([...directUrls, ...proxiedUrls])]
}

export function getVideoPlaybackUrl(
  post: Pick<
    FeedItem,
    'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl' | 'source' | 'videoCandidates'
  >,
) {
  const candidates = getVideoPlaybackCandidates(post)
  if (candidates.length > 0) {
    return candidates[0]
  }

  return ''
}

export function getVideoPlaybackStateKey(
  post: Pick<
    FeedItem,
    | 'fileExt'
    | 'fileUrl'
    | 'previewUrl'
    | 'sampleUrl'
    | 'source'
    | 'videoCandidates'
    | 'mediaResolved'
  >,
) {
  return [
    post.mediaResolved === true ? 'resolved' : 'unresolved',
    getVideoPlaybackUrl(post),
    ...getVideoPlaybackCandidates(post),
  ].join('||')
}

export function getCardMediaUrl(post: FeedItem) {
  if (post.mediaType === 'video') {
    return getVideoPlaybackUrl(post)
  }

  if (isUnresolvedRealbooruPost(post)) {
    return nonEmptyUrls([post.previewUrl, post.sampleUrl, post.fileUrl])[0] ?? ''
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

  return nonEmptyUrls([post.previewUrl, getStillImageUrl(post), post.sampleUrl])[0] ?? ''
}

export function getPreloadImageUrl(post: FeedItem) {
  if (isUnresolvedRealbooruPost(post)) {
    return post.previewUrl || post.sampleUrl || ''
  }

  return getStillImageUrl(post) || nonEmptyUrls([post.previewUrl, post.sampleUrl])[0] || ''
}
