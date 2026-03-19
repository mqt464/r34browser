export interface ApiCredentials {
  userId: string
  apiKey: string
}

export type ExcludeFilterId = 'ai' | 'scat' | 'loliShota'

export type ExcludeFilterState = Record<ExcludeFilterId, boolean>

export interface UserPreferences {
  credentials: ApiCredentials
  excludeFilters: ExcludeFilterState
  masonryColumns: number
  hapticsEnabled: boolean
  autoplayEnabled: boolean
  preferShareOnMobile: boolean
  accentColor: string
}

export type PreferenceUpdates = Partial<
  Omit<UserPreferences, 'credentials' | 'excludeFilters'>
> & {
  credentials?: Partial<ApiCredentials>
  excludeFilters?: Partial<ExcludeFilterState>
}

export interface FeedItem {
  id: number
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
  source: string
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
}

export interface LocalLibraryItem extends FeedItem {
  kind: 'saved' | 'history' | 'downloaded'
  timestamp: number
}

export type FeedSignals = Record<string, number>

export interface AppContextValue {
  preferences: UserPreferences
  updatePreferences: (updates: PreferenceUpdates) => void
  savedIds: Set<number>
  hiddenIds: Set<number>
  mutedTags: Set<string>
  feedSignals: FeedSignals
  libraryVersion: number
  savePost: (post: FeedItem) => Promise<void>
  unsavePost: (postId: number) => Promise<void>
  hidePost: (post: FeedItem) => Promise<void>
  recordViewedPost: (post: FeedItem) => Promise<void>
  recordDownload: (post: FeedItem) => Promise<void>
  toggleMutedTag: (tag: string) => Promise<void>
}
