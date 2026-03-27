import type { ApiCredentials, FeedItem, SearchQuery, SourceId, TagSummary } from '../types'
import { createStorageKey } from './sources'
import { inferMediaType } from './media'
import { buildProxiedUrl } from './realbooruProxy'
import { normalizeTagType } from './tagMeta'

const RULE34_API_ENDPOINT = 'https://api.rule34.xxx/index.php'
const REALBOORU_ORIGIN = 'https://realbooru.com'
const REALBOORU_PROXY_COOLDOWN_MS = 10_000

let realbooruProxyUnavailableUntil = 0
let realbooruProxyUnavailableMessage: string | null = null
const realbooruDetailCache = new Map<number, FeedItem>()
const realbooruDetailPromises = new Map<number, Promise<FeedItem>>()

type ProviderOptions = {
  source: SourceId
  credentials?: ApiCredentials
}

type FetchPostsOptions = ProviderOptions & {
  page?: number
  limit?: number
  query?: Partial<SearchQuery>
  id?: number
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type RawRule34Post = {
  id?: number | string
  tags?: string
  preview_url?: string
  sample_url?: string
  file_url?: string
  file_ext?: string
  width?: number | string
  height?: number | string
  sample_width?: number | string
  sample_height?: number | string
  rating?: string
  score?: number | string
  owner?: string
  source?: string
  comment_count?: number | string
}

type HydratablePost = Omit<FeedItem, 'storageKey'>

type ProviderApi = {
  fetchPosts: (options: FetchPostsOptions) => Promise<FeedItem[]>
  fetchTagSuggestions: (credentials: ApiCredentials | undefined, term: string, limit?: number) => Promise<TagSummary[]>
  fetchTagMeta: (credentials: ApiCredentials | undefined, tags: string[]) => Promise<Map<string, TagSummary>>
  testCredentials: (credentials?: ApiCredentials) => Promise<void>
  requiresCredentials: boolean
}

function toNumber(value: number | string | undefined, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hydratePost(post: HydratablePost): FeedItem {
  return {
    ...post,
    storageKey: createStorageKey(post.source, post.id),
  }
}

function normalizeRule34Post(raw: RawRule34Post): FeedItem {
  const fileUrl = raw.file_url ?? ''
  const sampleUrl = raw.sample_url ?? fileUrl
  const previewUrl = raw.preview_url ?? sampleUrl ?? fileUrl
  const fileExt = raw.file_ext?.trim().toLowerCase()
  const rawTags = (raw.tags ?? '').trim()

  return hydratePost({
    id: toNumber(raw.id),
    source: 'rule34',
    tags: rawTags ? rawTags.split(/\s+/).filter(Boolean) : [],
    rawTags,
    previewUrl,
    sampleUrl,
    fileUrl,
    fileExt,
    width: toNumber(raw.width),
    height: toNumber(raw.height),
    sampleWidth: toNumber(raw.sample_width, toNumber(raw.width)),
    sampleHeight: toNumber(raw.sample_height, toNumber(raw.height)),
    rating: raw.rating ?? 'unknown',
    score: toNumber(raw.score),
    owner: raw.owner ?? 'unknown',
    sourceUrl: raw.source ?? '',
    commentCount: toNumber(raw.comment_count),
    mediaType: inferMediaType(fileUrl, fileExt),
  })
}

function getErrorMessage(payload: JsonValue, response: Response) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.replace(/^"+|"+$/g, '')
  }
  return `Rule34 request failed (${response.status})`
}

async function requestJson(url: string) {
  const response = await fetch(url)
  const text = await response.text()

  let payload: JsonValue
  try {
    payload = JSON.parse(text) as JsonValue
  } catch {
    throw new Error(text || `Request failed (${response.status})`)
  }

  if (!response.ok || typeof payload === 'string') {
    throw new Error(getErrorMessage(payload, response))
  }

  return payload
}

function requireRule34Credentials(credentials?: ApiCredentials) {
  if (!credentials?.userId || !credentials.apiKey) {
    throw new Error('Add your Rule34 user ID and API key in Settings before loading content.')
  }
}

function createRule34Params(credentials?: ApiCredentials) {
  requireRule34Credentials(credentials)
  const verifiedCredentials = credentials as ApiCredentials

  return new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    user_id: verifiedCredentials.userId,
    api_key: verifiedCredentials.apiKey,
  })
}

const rule34Api: ProviderApi = {
  requiresCredentials: true,
  async fetchPosts(options) {
    const { credentials, page = 0, limit = 24, query, id } = options
    const params = createRule34Params(credentials)

    params.set('limit', String(limit))
    if (page > 0) {
      params.set('pid', String(page))
    }
    if (id) {
      params.set('id', String(id))
    }

    const tags = [
      ...(query?.includeTags ?? []),
      ...(query?.excludeTags ?? []).map((tag) => `-${tag}`),
    ]
    if (tags.length > 0) {
      params.set('tags', tags.join(' '))
    }

    const url = new URL(RULE34_API_ENDPOINT)
    url.search = params.toString()
    const payload = (await requestJson(url.toString())) as RawRule34Post[]
    return payload.map(normalizeRule34Post).filter((post) => post.id > 0 && post.fileUrl)
  },
  async fetchTagSuggestions(_credentials, term, limit = 10) {
    const url = new URL('https://api.rule34.xxx/autocomplete.php')
    url.searchParams.set('q', term)

    const response = await fetch(url.toString())
    const payload = (await response.json()) as Array<
      | string
      | {
          label?: string
          value?: string
          post_count?: number | string
          category?: number | string
        }
    >

    const extractCountFromLabel = (label: string | undefined) => {
      if (!label) {
        return 0
      }

      const match = label.match(/\(([\d,]+)\)\s*$/)
      if (!match) {
        return 0
      }

      return toNumber(match[1]?.replace(/,/g, ''))
    }

    return payload
      .slice(0, limit)
      .map((item, index) => {
        if (typeof item === 'string') {
          return {
            id: index,
            name: item,
            count: 0,
            type: normalizeTagType(undefined),
          }
        }

        return {
          id: index,
          name: item.value ?? item.label ?? '',
          count: toNumber(item.post_count, extractCountFromLabel(item.label)),
          type: normalizeTagType(item.category),
        }
      })
      .filter((tag) => tag.name)
  },
  async fetchTagMeta(credentials, tags) {
    requireRule34Credentials(credentials)
    const verifiedCredentials = credentials as ApiCredentials
    const uniqueTags = [...new Set(tags)].filter(Boolean)
    const entries: Array<readonly [string, TagSummary]> = []
    const batchSize = 12

    async function fetchSingleTagMeta(tag: string) {
      const params = new URLSearchParams({
        page: 'dapi',
        s: 'tag',
        q: 'index',
        name: tag,
        json: '1',
        user_id: verifiedCredentials.userId,
        api_key: verifiedCredentials.apiKey,
      })

      const url = new URL(RULE34_API_ENDPOINT)
      url.search = params.toString()
      const response = await fetch(url.toString())
      const text = await response.text()

      try {
        const payload = JSON.parse(text) as Array<{
          id?: number | string
          name?: string
          count?: number | string
          type?: number | string
        }>

        const item = payload[0]
        if (!item) {
          return [tag, { id: 0, name: tag, count: 0, type: 0 }] as const
        }

        return [
          tag,
          {
            id: toNumber(item.id),
            name: item.name ?? tag,
            count: toNumber(item.count),
            type: normalizeTagType(item.type),
          },
        ] as const
      } catch {
        const parsed = new DOMParser().parseFromString(text, 'application/xml')
        const item = parsed.querySelector('tag')
        return [
          tag,
          {
            id: toNumber(item?.getAttribute('id') ?? undefined),
            name: item?.getAttribute('name') ?? tag,
            count: toNumber(item?.getAttribute('count') ?? undefined),
            type: normalizeTagType(item?.getAttribute('type') ?? undefined),
          },
        ] as const
      }
    }

    for (let index = 0; index < uniqueTags.length; index += batchSize) {
      const batchEntries = await Promise.all(
        uniqueTags.slice(index, index + batchSize).map((tag) => fetchSingleTagMeta(tag)),
      )
      entries.push(...batchEntries)
    }

    return new Map(entries)
  },
  async testCredentials(credentials) {
    await this.fetchPosts({
      source: 'rule34',
      credentials,
      limit: 1,
    })
  },
}

function createRealbooruProxyError() {
  return new Error(
    realbooruProxyUnavailableMessage ??
      'Realbooru proxy is unavailable. Update the Realbooru proxy URL in Settings.',
  )
}

function toAbsoluteUrl(url: string) {
  if (!url) {
    return ''
  }

  if (url.startsWith('//')) {
    return `https:${url}`
  }

  if (url.startsWith('/')) {
    return `${REALBOORU_ORIGIN}${url}`
  }

  return url
}

function normalizeAbsoluteUrl(url: string) {
  if (!url) {
    return ''
  }

  try {
    const parsed = new URL(url)
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/')
    return parsed.toString()
  } catch {
    return url
  }
}

function normalizeRealbooruAssetUrl(url: string) {
  return normalizeAbsoluteUrl(toAbsoluteUrl(url))
}

function normalizeRealbooruCsvTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, '_').toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function mapRealbooruThumbToSample(url: string) {
  const match = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)(?:[?#].*)?$/i.exec(
    url,
  )

  if (!match) {
    return url
  }

  return `${REALBOORU_ORIGIN}/samples/${match[1]}sample_${match[2]}.jpg`
}

function extractRealbooruAssetInfo(url: string) {
  const match = /\/(?:images|samples|thumbnails)\/(..\/..\/)(?:thumbnail_|sample_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)$/i.exec(
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

function createRealbooruVideoCandidates(url: string) {
  const assetInfo = extractRealbooruAssetInfo(url)
  if (!assetInfo) {
    return []
  }

  return [
    `${REALBOORU_ORIGIN}/images/${assetInfo.prefix}${assetInfo.md5}.mp4`,
    `${REALBOORU_ORIGIN}/images/${assetInfo.prefix}${assetInfo.md5}.webm`,
  ]
}

function extractRealbooruOriginalHref(document: Document, html: string) {
  const originalLink = queryAll<HTMLAnchorElement>(document, 'a[href]').find(
    (node) => node.textContent?.trim() === 'Original',
  )

  return (
    originalLink?.getAttribute('href')?.trim() ??
    html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*Original\s*<\/a>/i)?.[1]?.trim() ??
    ''
  )
}

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
}

function queryAll<T extends Element>(root: ParentNode, selector: string) {
  return Array.from(root.querySelectorAll<T>(selector))
}

function getRealbooruHref(node: Element | null) {
  const href = node?.getAttribute('href')?.trim() ?? ''
  return href ? toAbsoluteUrl(href) : ''
}

function extractRealbooruPostId(href: string) {
  const match = href.match(/[?&]id=(\d+)/)
  return match ? Number(match[1]) : 0
}

function parseRealbooruListPosts(document: Document, limit: number) {
  const posts: FeedItem[] = []
  const nodes = queryAll<HTMLAnchorElement>(document, 'div.col.thumb > a')

  for (const node of nodes) {
    const image = node.querySelector<HTMLImageElement>('img')
    const href = getRealbooruHref(node)
    const id =
      extractRealbooruPostId(href) ||
      toNumber(node.getAttribute('id')?.replace(/^p/, '') ?? undefined)

    if (!id || !image) {
      continue
    }

    const previewUrl = normalizeRealbooruAssetUrl(image.getAttribute('src')?.trim() ?? '')
    const sampleUrl = normalizeRealbooruAssetUrl(mapRealbooruThumbToSample(previewUrl))
    const rawTags = normalizeRealbooruCsvTags(image.getAttribute('title')?.trim() ?? '')
    const tags = rawTags.split(/\s+/).filter(Boolean)
    const videoHint = [image.getAttribute('style'), image.getAttribute('title')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    const videoCandidates =
      videoHint.includes('#0000ff') || /(video|webm|mp4)/.test(videoHint)
        ? createRealbooruVideoCandidates(previewUrl)
        : []
    const fileUrl = videoCandidates[0] ?? sampleUrl ?? previewUrl
    const fileExt = videoCandidates.length > 0
      ? 'mp4'
      : fileUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? ''

    posts.push(
      hydratePost({
        commentCount: 0,
        fileExt,
        fileUrl,
        height: 0,
        id,
        mediaResolved: false,
        mediaType:
          videoCandidates.length > 0 ? 'video' : inferMediaType(fileUrl, fileExt),
        owner: 'unknown',
        previewUrl,
        rating: 'adult',
        rawTags,
        sampleHeight: 0,
        sampleUrl,
        sampleWidth: 0,
        score: parseRealbooruScore(document, id),
        source: 'realbooru',
        sourceUrl: '',
        tags,
        videoCandidates: videoCandidates.length > 0 ? videoCandidates : undefined,
        width: 0,
      }),
    )

    if (posts.length >= limit) {
      break
    }
  }

  return posts
}

async function fetchRealbooruResource(targetUrl: string) {
  if (realbooruProxyUnavailableUntil > Date.now()) {
    throw createRealbooruProxyError()
  }

  let response: Response
  try {
    response = await fetch(buildProxiedUrl(targetUrl))
  } catch {
    realbooruProxyUnavailableUntil = Date.now() + REALBOORU_PROXY_COOLDOWN_MS
    realbooruProxyUnavailableMessage =
      'Realbooru proxy is unavailable. Update the Realbooru proxy URL in Settings.'
    throw createRealbooruProxyError()
  }

  if (!response.ok) {
    const message = `Realbooru proxy request failed (${response.status})`
    if (response.status >= 500) {
      realbooruProxyUnavailableUntil = Date.now() + REALBOORU_PROXY_COOLDOWN_MS
      realbooruProxyUnavailableMessage = message
    }

    throw new Error(message)
  }

  realbooruProxyUnavailableUntil = 0
  realbooruProxyUnavailableMessage = null

  return response.text()
}

function parseRealbooruScore(document: Document, postId: number) {
  const score = document.querySelector(`#psc${postId}`)?.textContent?.trim() ?? ''
  return toNumber(score)
}

function parseRealbooruOwner(document: Document) {
  return (
    document.querySelector('#tagLink a[href*="page=account&s=profile"]')?.textContent?.trim() ??
    'unknown'
  )
}

function parseRealbooruSourceUrl(document: Document, html: string) {
  return (
    document.querySelector<HTMLInputElement>('#source')?.value?.trim() ??
    html.match(/id="source"[^>]*value="([^"]*)"/i)?.[1]?.trim() ??
    ''
  )
}

function parseRealbooruTags(document: Document, html: string) {
  const rawTags =
    document.querySelector<HTMLTextAreaElement>('#tags')?.value?.trim() ??
    html.match(/<textarea[^>]*id="tags"[^>]*>([\s\S]*?)<\/textarea>/i)?.[1]?.trim() ??
    document.querySelector('#image')?.getAttribute('alt')?.trim() ??
    ''

  return {
    rawTags,
    tags: rawTags.split(/\s+/).filter(Boolean),
  }
}

function parseRealbooruMedia(document: Document, html: string) {
  const image =
    document.querySelector<HTMLImageElement>('#image')?.getAttribute('src')?.trim() ??
    html.match(/id="image"[^>]*src="([^"]+)"/i)?.[1]?.trim() ??
    ''
  const originalHref = extractRealbooruOriginalHref(document, html)

  if (image) {
    const displayUrl = normalizeRealbooruAssetUrl(image)
    const originalUrl = normalizeRealbooruAssetUrl(originalHref)
    const fileUrl = originalUrl || displayUrl
    return {
      fileExt: fileUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '',
      fileUrl,
      height: 0,
      mediaType: inferMediaType(fileUrl),
      previewUrl: displayUrl,
      sampleHeight: 0,
      sampleUrl: displayUrl,
      sampleWidth: 0,
      videoCandidates: undefined,
      width: 0,
    }
  }

  const sourceMatches = [...html.matchAll(/<source[^>]+src="([^"]+)"/gi)]
    .map((match) => normalizeRealbooruAssetUrl(match[1] ?? ''))
    .filter(Boolean)
  const sources = queryAll<HTMLSourceElement>(document, 'video source')
    .map((node) => normalizeRealbooruAssetUrl(node.getAttribute('src')?.trim() ?? ''))
    .concat(sourceMatches)
    .filter(Boolean)
  const sortedSources = [...new Set(sources)].sort((left, right) => {
    const leftMp4 = left.toLowerCase().includes('.mp4') ? 1 : 0
    const rightMp4 = right.toLowerCase().includes('.mp4') ? 1 : 0
    return rightMp4 - leftMp4
  })
  const fileUrl =
    sortedSources[0] ?? (normalizeRealbooruAssetUrl(originalHref) || undefined) ?? ''

  return {
    fileExt: fileUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '',
    fileUrl,
    height: 0,
    mediaType: inferMediaType(fileUrl),
    previewUrl: fileUrl,
    sampleHeight: 0,
    sampleUrl: fileUrl,
    sampleWidth: 0,
    videoCandidates: sortedSources.length > 0 ? sortedSources : undefined,
    width: 0,
  }
}

async function fetchRealbooruPostDetail(id: number) {
  const cached = realbooruDetailCache.get(id)
  if (cached) {
    return cached
  }

  const html = await fetchRealbooruResource(
    `${REALBOORU_ORIGIN}/index.php?page=post&s=view&id=${id}`,
  )
  const document = parseHtml(html)
  const { rawTags, tags } = parseRealbooruTags(document, html)
  const media = parseRealbooruMedia(document, html)

  const post = hydratePost({
    commentCount: queryAll(document, '.userComment').length,
    id,
    mediaResolved: true,
    owner: parseRealbooruOwner(document),
    rating: 'adult',
    rawTags,
    score: parseRealbooruScore(document, id),
    source: 'realbooru',
    sourceUrl: parseRealbooruSourceUrl(document, html),
    tags,
    ...media,
  })

  realbooruDetailCache.set(id, post)
  return post
}

function mergeRealbooruPost(base: FeedItem, detail: FeedItem) {
  if (base.mediaType === 'video' && base.mediaResolved !== true) {
    return hydratePost({
      ...base,
      ...detail,
      fileUrl: detail.fileUrl || base.fileUrl,
      mediaResolved: true,
      previewUrl: base.previewUrl || detail.previewUrl,
      sampleUrl: base.sampleUrl || base.previewUrl || detail.sampleUrl,
      sourceUrl: detail.sourceUrl || base.sourceUrl,
      videoCandidates: [
        ...new Set(
          [
            ...(detail.videoCandidates ?? []),
            detail.fileUrl,
            ...(base.videoCandidates ?? []),
            base.fileUrl,
          ].filter(Boolean),
        ),
      ],
    })
  }

  const basePreviewIsStill = inferMediaType(base.previewUrl) !== 'video'
  const baseSampleIsStill = inferMediaType(base.sampleUrl) !== 'video'

  return hydratePost({
    ...base,
    ...detail,
    mediaResolved: true,
    previewUrl:
      detail.mediaType === 'video'
        ? (basePreviewIsStill ? base.previewUrl : '') || detail.previewUrl
        : detail.previewUrl || base.previewUrl,
    sampleUrl:
      detail.mediaType === 'video'
        ? (baseSampleIsStill ? base.sampleUrl : '') ||
          (basePreviewIsStill ? base.previewUrl : '') ||
          detail.sampleUrl
        : detail.sampleUrl || base.sampleUrl,
    sourceUrl: detail.sourceUrl || base.sourceUrl,
    videoCandidates: detail.videoCandidates?.length ? detail.videoCandidates : base.videoCandidates,
  })
}

export function needsRealbooruMediaEnrichment(post: FeedItem) {
  return post.source === 'realbooru' && post.mediaResolved !== true
}

export async function enrichRealbooruPost(post: FeedItem) {
  if (post.source !== 'realbooru' || post.mediaResolved === true) {
    return post
  }

  const cached = realbooruDetailCache.get(post.id)
  if (cached) {
    return mergeRealbooruPost(post, cached)
  }

  const pending =
    realbooruDetailPromises.get(post.id) ??
    fetchRealbooruPostDetail(post.id).finally(() => {
      realbooruDetailPromises.delete(post.id)
    })

  realbooruDetailPromises.set(post.id, pending)
  const detail = await pending
  return mergeRealbooruPost(post, detail)
}

function parseRealbooruTypeLabel(typeText = '') {
  const normalized = typeText.toLowerCase()
  if (normalized.includes('artist')) {
    return 1
  }
  if (normalized.includes('character')) {
    return 4
  }
  if (normalized.includes('copyright')) {
    return 3
  }
  if (normalized.includes('metadata') || normalized.includes('meta')) {
    return 5
  }
  if (normalized.includes('deprecated')) {
    return 6
  }
  return 0
}

async function fetchRealbooruTagMeta(tag: string) {
  const url = new URL(`${REALBOORU_ORIGIN}/index.php?page=tags&s=list`)
  url.searchParams.set('tags', tag)
  const html = await fetchRealbooruResource(url.toString())
  const document = parseHtml(html)
  const rows = queryAll<HTMLTableRowElement>(document, 'table.highlightable tr')
  const match = rows.find((row) => {
    const href = getRealbooruHref(
      row.querySelector<HTMLAnchorElement>('a[href*="page=post&s=list&tags="]'),
    )
    return href.includes(`tags=${tag}`)
  })

  if (!match) {
    return {
      count: 0,
      id: 0,
      name: tag,
      type: 0,
    }
  }

  const cells = queryAll<HTMLTableCellElement>(match, 'td')
  return {
    count: toNumber(cells[0]?.textContent?.trim().replace(/,/g, '')),
    id: 0,
    name: tag,
    type: parseRealbooruTypeLabel(cells[2]?.textContent?.trim() ?? ''),
  }
}

const realbooruApi: ProviderApi = {
  requiresCredentials: false,
  async fetchPosts(options) {
    if (options.id) {
      return [await fetchRealbooruPostDetail(options.id)]
    }

    const url = new URL(`${REALBOORU_ORIGIN}/index.php?page=post&s=list`)
    url.searchParams.set(
      'tags',
      [
        ...(options.query?.includeTags ?? []),
        ...(options.query?.excludeTags ?? []).map((tag) => `-${tag}`),
      ].join(' ') || 'all',
    )
    if ((options.page ?? 0) > 0) {
      url.searchParams.set('pid', String((options.page ?? 0) * 42))
    }

    const html = await fetchRealbooruResource(url.toString())
    const document = parseHtml(html)
    return parseRealbooruListPosts(document, options.limit ?? 24)
  },
  async fetchTagSuggestions(_credentials, term, limit = 10) {
    const text = await fetchRealbooruResource(
      `${REALBOORU_ORIGIN}/index.php?page=autocomplete&term=${encodeURIComponent(term)}`,
    )
    const suggestions = (JSON.parse(text) as string[]).slice(0, limit)
    const meta = await Promise.all(suggestions.map((tag) => fetchRealbooruTagMeta(tag)))

    return meta.map((entry, index) => ({
      ...entry,
      id: index,
      type: normalizeTagType(entry.type),
    }))
  },
  async fetchTagMeta(_credentials, tags) {
    const payload = await Promise.all(tags.map((tag) => fetchRealbooruTagMeta(tag)))
    return new Map(
      payload.map((entry) => [entry.name, { ...entry, type: normalizeTagType(entry.type) }]),
    )
  },
  async testCredentials() {
    await fetchRealbooruResource(`${REALBOORU_ORIGIN}/index.php?page=autocomplete&term=gi`)
  },
}

const PROVIDERS: Record<SourceId, ProviderApi> = {
  rule34: rule34Api,
  realbooru: realbooruApi,
}

function getProvider(source: SourceId) {
  return PROVIDERS[source]
}

export function providerRequiresCredentials(source: SourceId) {
  return getProvider(source).requiresCredentials
}

export async function fetchPosts(options: FetchPostsOptions) {
  return getProvider(options.source).fetchPosts(options)
}

export async function fetchTagSuggestions(options: ProviderOptions & { term: string; limit?: number }) {
  return getProvider(options.source).fetchTagSuggestions(options.credentials, options.term, options.limit)
}

export async function fetchTagMeta(options: ProviderOptions & { tags: string[] }) {
  return getProvider(options.source).fetchTagMeta(options.credentials, options.tags)
}

export async function testCredentials(options: ProviderOptions) {
  return getProvider(options.source).testCredentials(options.credentials)
}
