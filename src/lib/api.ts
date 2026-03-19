import type { ApiCredentials, FeedItem, SearchQuery } from '../types'
import { inferMediaType } from './media'
import { normalizeTagType } from './tagMeta'

const API_ENDPOINT = 'https://api.rule34.xxx/index.php'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type RawPost = {
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

function toNumber(value: number | string | undefined, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizePost(raw: RawPost): FeedItem {
  const fileUrl = raw.file_url ?? ''
  const sampleUrl = raw.sample_url ?? fileUrl
  const previewUrl = raw.preview_url ?? sampleUrl ?? fileUrl
  const fileExt = raw.file_ext?.trim().toLowerCase()
  const rawTags = (raw.tags ?? '').trim()

  return {
    id: toNumber(raw.id),
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
    source: raw.source ?? '',
    commentCount: toNumber(raw.comment_count),
    mediaType: inferMediaType(fileUrl, fileExt),
  }
}

function getErrorMessage(payload: JsonValue, response: Response) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.replace(/^"+|"+$/g, '')
  }
  return `Rule34 request failed (${response.status})`
}

async function requestJson(params: URLSearchParams) {
  const url = new URL(API_ENDPOINT)
  url.search = params.toString()

  const response = await fetch(url.toString())
  const text = await response.text()

  let payload: JsonValue
  try {
    payload = JSON.parse(text) as JsonValue
  } catch {
    throw new Error(text || `Rule34 request failed (${response.status})`)
  }

  if (!response.ok || typeof payload === 'string') {
    throw new Error(getErrorMessage(payload, response))
  }

  return payload
}

function applyAuth(params: URLSearchParams, credentials: ApiCredentials) {
  if (!credentials.userId || !credentials.apiKey) {
    throw new Error('Add your Rule34 user ID and API key in Settings before loading content.')
  }

  params.set('user_id', credentials.userId)
  params.set('api_key', credentials.apiKey)
}

function createBaseParams(credentials: ApiCredentials) {
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
  })

  applyAuth(params, credentials)
  return params
}

export async function fetchPosts(options: {
  credentials: ApiCredentials
  page?: number
  limit?: number
  query?: Partial<SearchQuery>
  id?: number
}) {
  const { credentials, page = 0, limit = 24, query, id } = options
  const params = createBaseParams(credentials)

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

  const payload = (await requestJson(params)) as RawPost[]
  return payload.map(normalizePost).filter((post) => post.id > 0 && post.fileUrl)
}

export async function fetchTagSuggestions(
  _credentials: ApiCredentials,
  term: string,
  limit = 10,
) {
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
}

function parseTagXml(xml: string) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(parsed.querySelectorAll('tag')).map((node) => ({
    id: toNumber(node.getAttribute('id') ?? undefined),
    name: node.getAttribute('name') ?? '',
    count: toNumber(node.getAttribute('count') ?? undefined),
    type: normalizeTagType(node.getAttribute('type') ?? undefined),
  }))
}

async function fetchSingleTagMeta(credentials: ApiCredentials, tag: string) {
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'tag',
    q: 'index',
    name: tag,
    json: '1',
  })

  if (credentials.userId && credentials.apiKey) {
    params.set('user_id', credentials.userId)
    params.set('api_key', credentials.apiKey)
  }

  const url = new URL(API_ENDPOINT)
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
      return [
        tag,
        { id: 0, name: tag, count: 0, type: normalizeTagType(undefined) },
      ] as const
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
    const [item] = parseTagXml(text)
    return [
      tag,
      item ?? { id: 0, name: tag, count: 0, type: normalizeTagType(undefined) },
    ] as const
  }
}

export async function fetchTagMeta(credentials: ApiCredentials, tags: string[]) {
  const uniqueTags = [...new Set(tags)].filter(Boolean)
  const entries: Array<
    readonly [
      string,
      {
        id: number
        name: string
        count: number
        type: number
      },
    ]
  > = []
  const batchSize = 12

  for (let index = 0; index < uniqueTags.length; index += batchSize) {
    const batchEntries = await Promise.all(
      uniqueTags.slice(index, index + batchSize).map((tag) => fetchSingleTagMeta(credentials, tag)),
    )
    entries.push(...batchEntries)
  }

  return new Map(entries)
}

export async function testCredentials(credentials: ApiCredentials) {
  await fetchPosts({
    credentials,
    limit: 1,
  })
}
