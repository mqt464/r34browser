export type SourceId = 'rule34' | 'realbooru'

export interface ApiCredentials {
  userId: string
  apiKey: string
}

export type ExcludeFilterId = 'ai' | 'scat' | 'loliShota'

export type ExcludeFilterState = Record<ExcludeFilterId, boolean>

export interface UserPreferences {
  rule34Credentials: ApiCredentials
  defaultSource: SourceId
  searchSource: SourceId
  realbooruProxyUrl: string
  excludeFilters: ExcludeFilterState
  masonryColumns: number
  hapticsEnabled: boolean
  autoplayEnabled: boolean
  preferShareOnMobile: boolean
  accentColor: string
}

export type PreferenceUpdates = Partial<
  Omit<UserPreferences, 'rule34Credentials' | 'excludeFilters'>
> & {
  rule34Credentials?: Partial<ApiCredentials>
  excludeFilters?: Partial<ExcludeFilterState>
}

export interface FeedItem {
  id: number
  source: SourceId
  storageKey: string
  mediaResolved?: boolean
  videoCandidates?: string[]
  tags: string[]
  rawTags: string
  previewUrl: string
  sampleUrl: string
  fileUrl: string
  fileExt?: string
  width: number
  height: number
  sampleWidth: number
  sampleHeight: number
  rating: string
  score: number
  owner: string
  sourceUrl: string
  commentCount: number
  mediaType: 'image' | 'video' | 'gif'
}

export type PostDetail = FeedItem

export type TagTypeKey =
  | 'general'
  | 'artist'
  | 'copyright'
  | 'character'
  | 'meta'
  | 'deprecated'
  | 'unknown'

export interface TagMeta {
  id: number
  name: string
  count: number
  type: number
}

export type TagSummary = TagMeta

export interface SearchQuery {
  includeTags: string[]
  excludeTags: string[]
}

export interface SearchNavigationState {
  pendingQuery?: string
  pendingSource?: SourceId
}

export interface LocalLibraryItem extends FeedItem {
  kind: 'saved' | 'history' | 'downloaded'
  timestamp: number
}

export type FeedSignals = Record<string, number>

export interface AppContextValue {
  preferences: UserPreferences
  updatePreferences: (updates: PreferenceUpdates) => void
  savedIds: Set<string>
  hiddenIds: Set<string>
  mutedTags: Set<string>
  feedSignals: FeedSignals
  libraryVersion: number
  savePost: (post: FeedItem) => Promise<void>
  unsavePost: (storageKey: string) => Promise<void>
  hidePost: (post: FeedItem) => Promise<void>
  recordViewedPost: (post: FeedItem) => Promise<void>
  recordDownload: (post: FeedItem) => Promise<void>
  toggleMutedTag: (tag: string) => Promise<void>
}
