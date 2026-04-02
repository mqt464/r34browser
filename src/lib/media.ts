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

function hasVideoTag(value: string) {
  return /(^|[\s,_-])(mp4|webm|video)(?=$|[\s,_-])/i.test(value)
}

function extractRealbooruAssetInfo(url: string) {
  const match = /https?:\/\/(?:video-cdn\.)?realbooru\.com\/(?:images|samples|thumbnails)\/(..\/..\/)(?:thumbnail_|sample_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp|mp4|webm)$/i.exec(
    url.split(/[?#]/, 1)[0] ?? '',
  )

  if (!match) {
    return null
  }

  return {
    md5: match[2],
    prefix: match[1],
  }
}

function getRealbooruCanonicalVideoUrls(urls: string[]) {
  const derived = urls.flatMap((url) => {
    const assetInfo = extractRealbooruAssetInfo(url)
    if (!assetInfo) {
      return []
    }

    return [
      `https://realbooru.com/images/${assetInfo.prefix}${assetInfo.md5}.mp4`,
      `https://video-cdn.realbooru.com/images/${assetInfo.prefix}${assetInfo.md5}.mp4`,
      `https://realbooru.com/images/${assetInfo.prefix}${assetInfo.md5}.webm`,
      `https://video-cdn.realbooru.com/images/${assetInfo.prefix}${assetInfo.md5}.webm`,
    ]
  })

  return [...new Set(derived)]
}

export function getMediaDimensions(
  post: Pick<FeedItem, 'sampleHeight' | 'sampleWidth' | 'height' | 'width'>,
) {
  const dimensions = [
    { height: post.sampleHeight, width: post.sampleWidth },
    { height: post.height, width: post.width },
  ]

  return (
    dimensions.find(
      (candidate) => candidate.width > 0 && candidate.height > 0,
    ) ?? { height: 1, width: 1 }
  )
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

export function hasVideoPlaybackEvidence(
  post: Pick<FeedItem, 'fileExt' | 'mediaType' | 'rawTags' | 'videoCandidates'>,
) {
  if (post.mediaType === 'video') {
    return true
  }

  if (trimExtension(post.fileExt) && inferMediaType('', post.fileExt) === 'video') {
    return true
  }

  if ((post.videoCandidates ?? []).some((url) => inferMediaType(url) === 'video')) {
    return true
  }

  return hasVideoTag(post.rawTags)
}

export function canRenderRealbooruMediaWithoutEnrichment(
  post: Pick<
    FeedItem,
    'fileExt' | 'fileUrl' | 'mediaResolved' | 'mediaType' | 'previewUrl' | 'rawTags' | 'sampleUrl' | 'source' | 'videoCandidates'
  >,
) {
  if (post.source !== 'realbooru' || post.mediaResolved === true) {
    return false
  }

  if (hasVideoPlaybackEvidence(post)) {
    return getVideoPlaybackCandidates(post).length > 0
  }

  return nonEmptyUrls([post.sampleUrl, post.previewUrl, post.fileUrl]).length > 0
}

export function getStillImageUrl(
  post: Pick<FeedItem, 'fileExt' | 'fileUrl' | 'previewUrl' | 'sampleUrl' | 'source'>,
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
  const derivedRealbooruUrls =
    post.source === 'realbooru'
      ? getRealbooruCanonicalVideoUrls(
          nonEmptyUrls([post.fileUrl, post.sampleUrl, post.previewUrl, ...candidateUrls]),
        )
      : []

  const primaryUrl =
    post.fileUrl && inferMediaType(post.fileUrl, post.fileExt) === 'video' ? post.fileUrl : ''
  const fallbackUrls = nonEmptyUrls([post.sampleUrl, post.previewUrl]).filter(
    (url) => inferMediaType(url) === 'video',
  )

  const directUrls = [
    ...new Set(nonEmptyUrls([primaryUrl, ...candidateUrls, ...derivedRealbooruUrls, ...fallbackUrls])),
  ]

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
  if (hasVideoPlaybackEvidence(post)) {
    return getVideoPlaybackUrl(post)
  }

  if (isUnresolvedRealbooruPost(post)) {
    return nonEmptyUrls([post.sampleUrl, post.previewUrl, post.fileUrl])[0] ?? ''
  }

  return nonEmptyUrls([post.sampleUrl, post.fileUrl, post.previewUrl])[0] ?? ''
}

export function getDetailMediaUrl(post: FeedItem) {
  if (hasVideoPlaybackEvidence(post)) {
    return getVideoPlaybackUrl(post)
  }

  return nonEmptyUrls([post.fileUrl, post.sampleUrl, post.previewUrl])[0] ?? ''
}

export function getMediaPosterUrl(post: FeedItem) {
  if (!hasVideoPlaybackEvidence(post)) {
    return ''
  }

  return nonEmptyUrls([getStillImageUrl(post), post.previewUrl, post.sampleUrl])[0] ?? ''
}

export function getPreloadImageUrl(post: FeedItem) {
  if (isUnresolvedRealbooruPost(post)) {
    return post.previewUrl || post.sampleUrl || ''
  }

  return getStillImageUrl(post) || nonEmptyUrls([post.previewUrl, post.sampleUrl])[0] || ''
}
