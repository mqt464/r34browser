import { fetchPosts, fetchTagMeta } from './api'
import { getTagTypeDetails } from './tagMeta'
import type {
  ApiCredentials,
  FeedItem,
  LocalLibraryItem,
  SearchQuery,
  SourceId,
  TagMeta,
} from '../types'

const OVERALL_CANDIDATE_LIMIT = 120
const POSITIONAL_CANDIDATE_LIMIT = 120
const EARLY_TAG_CANDIDATE_LIMIT = 120
const MAX_CANDIDATE_TAGS = 180
const MAX_GENERAL_TAGS = 2
const POSITIONAL_SCAN_DEPTH = 8
const HOME_QUERY_COUNT = 3
const HOME_LIMIT_MIN = 5
const HOME_LIMIT_MAX = 10
const HOME_BATCH_PAGE_SCAN_LIMIT = 8
const HOME_FRESH_POST_TARGET = 12
const HOME_RECENT_ANCHOR_MEMORY = 9
const TAG_META_CACHE_KEY = 'r34browser.homeTagMeta'
const TAG_META_CACHE_TTL = 1000 * 60 * 60 * 24 * 14

const ANCHOR_TYPE_WEIGHTS = {
  artist: 1,
  character: 5,
  copyright: 12,
} as const

const ANCHOR_POOL_PUSH_WEIGHTS = {
  artist: 2,
  character: 9,
  copyright: 18,
} as const

type AnchorType = keyof typeof ANCHOR_TYPE_WEIGHTS

interface WeightedTag {
  score: number
  tag: string
}

export interface HomeFeedModel {
  anchorBuckets: Record<AnchorType, WeightedTag[]>
  blockedTags: string[]
  discoveryAnchors: WeightedTag[]
  fallbackGeneralTags: WeightedTag[]
  focusTags: string[]
  generalTagsByAnchor: Record<string, WeightedTag[]>
  weightedAnchors: WeightedTag[]
}

type CachedTagMetaRecord = Record<
  string,
  Pick<TagMeta, 'count' | 'id' | 'name' | 'type'> & { cachedAt: number }
>

function incrementScore(map: Map<string, number>, tag: string, amount: number) {
  map.set(tag, (map.get(tag) ?? 0) + amount)
}

function topTags(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

function uniqueTags(tags: string[]) {
  return [...new Set(tags)]
}

function toWeightedTags(scores: Map<string, number>) {
  return [...scores.entries()]
    .map(([tag, score]) => ({ score, tag }))
    .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
}

function randomIntInclusive(min: number, max: number) {
  const lower = Math.ceil(min)
  const upper = Math.floor(max)
  return Math.floor(Math.random() * (upper - lower + 1)) + lower
}

function shuffleItems<T>(items: T[]) {
  const next = [...items]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!]
  }

  return next
}

function dedupePosts(posts: FeedItem[]) {
  const seen = new Set<string>()
  return posts.filter((post) => {
    if (seen.has(post.storageKey)) {
      return false
    }

    seen.add(post.storageKey)
    return true
  })
}

function loadCachedTagMeta() {
  const rawValue = localStorage.getItem(TAG_META_CACHE_KEY)
  if (!rawValue) {
    return {} satisfies CachedTagMetaRecord
  }

  try {
    return JSON.parse(rawValue) as CachedTagMetaRecord
  } catch {
    return {} satisfies CachedTagMetaRecord
  }
}

function saveCachedTagMeta(cache: CachedTagMetaRecord) {
  localStorage.setItem(TAG_META_CACHE_KEY, JSON.stringify(cache))
}

async function resolveTagMeta(source: SourceId, credentials: ApiCredentials | undefined, tags: string[]) {
  const now = Date.now()
  const unique = uniqueTags(tags).filter(Boolean)
  const cache = loadCachedTagMeta()
  const resolved = new Map<string, TagMeta>()
  const missing: string[] = []

  for (const tag of unique) {
    const cached = cache[tag]
    if (cached && now - cached.cachedAt < TAG_META_CACHE_TTL) {
      resolved.set(tag, {
        count: cached.count,
        id: cached.id,
        name: cached.name,
        type: cached.type,
      })
      continue
    }

    missing.push(tag)
  }

  if (missing.length > 0) {
    const fetched = await fetchTagMeta({ source, credentials, tags: missing })

    for (const [tag, meta] of fetched.entries()) {
      cache[tag] = {
        cachedAt: now,
        count: meta.count,
        id: meta.id,
        name: meta.name,
        type: meta.type,
      }
      resolved.set(tag, meta)
    }

    saveCachedTagMeta(cache)
  }

  return resolved
}

function buildCandidateTags(savedPosts: LocalLibraryItem[], blockedTags: Set<string>) {
  const overallScores = new Map<string, number>()
  const positionalScores = new Map<string, number>()
  const earlyTagScores = new Map<string, number>()

  for (const post of savedPosts) {
    post.tags.forEach((tag, index) => {
      if (!tag || blockedTags.has(tag)) {
        return
      }

      incrementScore(overallScores, tag, 1)
      if (index < POSITIONAL_SCAN_DEPTH) {
        incrementScore(positionalScores, tag, POSITIONAL_SCAN_DEPTH - index)
      }
      if (index < 4) {
        incrementScore(earlyTagScores, tag, 5 - index)
      }
    })
  }

  return uniqueTags([
    ...topTags(overallScores, OVERALL_CANDIDATE_LIMIT),
    ...topTags(positionalScores, POSITIONAL_CANDIDATE_LIMIT),
    ...topTags(earlyTagScores, EARLY_TAG_CANDIDATE_LIMIT),
  ]).slice(0, MAX_CANDIDATE_TAGS)
}

function weightedChoice(entries: WeightedTag[], excludedTags = new Set<string>()) {
  const candidates = entries.filter((entry) => entry.score > 0 && !excludedTags.has(entry.tag))
  if (candidates.length === 0) {
    return null
  }

  const total = candidates.reduce((sum, entry) => sum + entry.score, 0)
  let cursor = Math.random() * total

  for (const entry of candidates) {
    cursor -= entry.score
    if (cursor <= 0) {
      return entry
    }
  }

  return candidates[candidates.length - 1] ?? null
}

function getAnchorType(meta: TagMeta) {
  const key = getTagTypeDetails(meta.type).key
  if (key === 'artist' || key === 'character' || key === 'copyright') {
    return key as AnchorType
  }
  return null
}

export async function buildHomeFeedModel(options: {
  blockedTags: string[]
  credentials?: ApiCredentials
  savedPosts: LocalLibraryItem[]
  source: SourceId
}): Promise<HomeFeedModel> {
  const { blockedTags, credentials, savedPosts, source } = options
  const blockedSet = new Set(blockedTags)
  const candidateTags = buildCandidateTags(savedPosts, blockedSet)

  if (candidateTags.length === 0) {
    return {
      anchorBuckets: {
        artist: [],
        character: [],
        copyright: [],
      },
      blockedTags,
      discoveryAnchors: [],
      fallbackGeneralTags: [],
      focusTags: [],
      generalTagsByAnchor: {},
      weightedAnchors: [],
    }
  }

  const metaByTag = await resolveTagMeta(source, credentials, candidateTags)
  const candidateTagSet = new Set(candidateTags)
  const localCounts = new Map<string, number>()
  const anchorPostCounts = new Map<string, number>()
  const anchorScores = {
    artist: new Map<string, number>(),
    character: new Map<string, number>(),
    copyright: new Map<string, number>(),
  } satisfies Record<AnchorType, Map<string, number>>
  const generalScores = new Map<string, number>()
  const anchorGeneralScores = new Map<string, Map<string, number>>()
  const generalAnchorBreadth = new Map<string, Set<string>>()

  for (const post of savedPosts) {
    const anchorsInPost: string[] = []
    const generalTagsInPost: string[] = []

    post.tags.forEach((tag) => {
      if (!candidateTagSet.has(tag) || blockedSet.has(tag)) {
        return
      }

      incrementScore(localCounts, tag, 1)
      const meta = metaByTag.get(tag)
      if (!meta) {
        return
      }

      const anchorType = getAnchorType(meta)
      if (anchorType) {
        anchorsInPost.push(tag)
        incrementScore(anchorScores[anchorType], tag, ANCHOR_TYPE_WEIGHTS[anchorType])
        return
      }

      if (getTagTypeDetails(meta.type).key === 'general') {
        generalTagsInPost.push(tag)
        incrementScore(generalScores, tag, 1)
      }
    })

    for (const anchor of anchorsInPost) {
      incrementScore(anchorPostCounts, anchor, 1)
      const bucket = anchorGeneralScores.get(anchor) ?? new Map<string, number>()
      for (const generalTag of generalTagsInPost) {
        incrementScore(bucket, generalTag, 1)
        const anchorSet = generalAnchorBreadth.get(generalTag) ?? new Set<string>()
        anchorSet.add(anchor)
        generalAnchorBreadth.set(generalTag, anchorSet)
      }
      anchorGeneralScores.set(anchor, bucket)
    }
  }

  const anchorBuckets = {
    artist: toWeightedTags(
      new Map(
        [...anchorScores.artist.entries()].map(([tag, score]) => [
          tag,
          score * 2 +
            Math.pow(anchorPostCounts.get(tag) ?? 0, 1.15) * ANCHOR_POOL_PUSH_WEIGHTS.artist +
            (localCounts.get(tag) ?? 0) * 0.2,
        ]),
      ),
    ),
    character: toWeightedTags(
      new Map(
        [...anchorScores.character.entries()].map(([tag, score]) => [
          tag,
          score * 2 +
            Math.pow(anchorPostCounts.get(tag) ?? 0, 1.15) * ANCHOR_POOL_PUSH_WEIGHTS.character +
            (localCounts.get(tag) ?? 0) * 0.2,
        ]),
      ),
    ),
    copyright: toWeightedTags(
      new Map(
        [...anchorScores.copyright.entries()].map(([tag, score]) => [
          tag,
          score * 2 +
            Math.pow(anchorPostCounts.get(tag) ?? 0, 1.15) *
              ANCHOR_POOL_PUSH_WEIGHTS.copyright +
            (localCounts.get(tag) ?? 0) * 0.2,
        ]),
      ),
    ),
  } satisfies Record<AnchorType, WeightedTag[]>
  const weightedAnchors = [
    ...anchorBuckets.copyright,
    ...anchorBuckets.character,
    ...anchorBuckets.artist,
  ]

  const fallbackGeneralTags = toWeightedTags(generalScores)
  const generalTagsByAnchor = Object.fromEntries(
    [...anchorGeneralScores.entries()].map(([anchor, scores]) => [
      anchor,
      [...scores.entries()]
        .map(([tag, score]) => ({
          score:
            (score * 10 +
              ((score / Math.max(anchorPostCounts.get(anchor) ?? 1, 1)) * 36) +
              (generalScores.get(tag) ?? 0) * 0.25) /
            Math.sqrt(Math.max(generalAnchorBreadth.get(tag)?.size ?? 1, 1)),
          tag,
        }))
        .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag)),
    ]),
  ) as Record<string, WeightedTag[]>
  const discoveryAnchors = toWeightedTags(
    new Map(
      weightedAnchors.slice(1, 40).map(({ score, tag }, index) => [
        tag,
        Math.max(score, 1) / Math.sqrt(index + 1),
      ]),
    ),
  )

  return {
    anchorBuckets,
    blockedTags,
    discoveryAnchors,
    fallbackGeneralTags,
    focusTags: uniqueTags(
      [
        ...anchorBuckets.copyright.slice(0, 4),
        ...anchorBuckets.character.slice(0, 2),
        ...anchorBuckets.artist.slice(0, 2),
        ...discoveryAnchors.slice(0, 2),
        ...(weightedAnchors.length === 0 ? fallbackGeneralTags.slice(0, 4) : []),
      ]
        .slice(0, 8)
        .map((entry) => entry.tag),
    ),
    generalTagsByAnchor,
    weightedAnchors,
  }
}

export function createHomeFeedQueries(
  model: HomeFeedModel,
  queryCount = HOME_QUERY_COUNT,
  recentAnchors: string[] = [],
) {
  if (
    model.anchorBuckets.copyright.length === 0 &&
    model.anchorBuckets.character.length === 0 &&
    model.anchorBuckets.artist.length === 0
  ) {
    const fallback = model.fallbackGeneralTags.slice(0, MAX_GENERAL_TAGS).map((entry) => entry.tag)
    return fallback.length > 0
      ? [
          {
            excludeTags: model.blockedTags,
            includeTags: fallback,
          },
        ]
      : []
  }

  const usedAnchors = new Set<string>()
  const recentAnchorSet = new Set(recentAnchors)
  const queries: SearchQuery[] = []
  const poolOrder: AnchorType[] = ['copyright', 'character', 'artist']
  const availablePools = poolOrder.filter((pool) => model.anchorBuckets[pool].length > 0)

  while (queries.length < queryCount && availablePools.length > 0) {
    let selectedInPass = false

    for (const pool of availablePools) {
      if (queries.length >= queryCount) {
        break
      }

      const entries = model.anchorBuckets[pool]
      const anchor =
        weightedChoice(entries, new Set([...usedAnchors, ...recentAnchorSet])) ??
        weightedChoice(entries, usedAnchors)

      if (!anchor) {
        continue
      }

      usedAnchors.add(anchor.tag)
      queries.push({
        excludeTags: model.blockedTags,
        includeTags: [anchor.tag],
      })
      selectedInPass = true
    }

    if (!selectedInPass) {
      break
    }
  }

  return queries
}

export async function fetchHomeFeedBatch(options: {
  credentials?: ApiCredentials
  excludedPostIds?: Iterable<string>
  model: HomeFeedModel
  page: number
  recentAnchors?: string[]
  source: SourceId
}) {
  const { credentials, excludedPostIds = [], model, page, recentAnchors = [], source } = options
  const queries = createHomeFeedQueries(model, HOME_QUERY_COUNT, recentAnchors)

  if (queries.length === 0) {
    return {
      anchors: [] as string[],
      hasMore: false,
      nextPage: page,
      posts: [] as FeedItem[],
    }
  }

  const seenIds = new Set<string>(excludedPostIds)
  const freshPosts: FeedItem[] = []
  let nextPage = page
  let exhausted = false

  // Skip past pages that only contain saved or already-shown posts.
  for (
    let scanCount = 0;
    scanCount < HOME_BATCH_PAGE_SCAN_LIMIT && freshPosts.length < HOME_FRESH_POST_TARGET;
    scanCount += 1
  ) {
    const batches = await Promise.all(
      queries.map((query) =>
        fetchPosts({
          source,
          credentials,
          limit: randomIntInclusive(HOME_LIMIT_MIN, HOME_LIMIT_MAX),
          page: nextPage,
          query,
        }),
      ),
    )

    nextPage += 1

    if (!batches.some((batch) => batch.length > 0)) {
      exhausted = true
      break
    }

    const combinedPosts = shuffleItems(dedupePosts(batches.flat())).filter((post) => {
      if (seenIds.has(post.storageKey)) {
        return false
      }

      seenIds.add(post.storageKey)
      return true
    })

    freshPosts.push(...combinedPosts)
  }

  return {
    anchors: queries.map((query) => query.includeTags[0] ?? '').filter(Boolean),
    hasMore: !exhausted,
    nextPage,
    posts: freshPosts,
  }
}

export { HOME_RECENT_ANCHOR_MEMORY }
