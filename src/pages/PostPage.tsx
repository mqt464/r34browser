import { Bookmark, BookmarkCheck, Copy, Download, EyeOff, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FeedGrid } from '../components/FeedGrid'
import { SyncedVideo } from '../components/SyncedVideo'
import { fetchPosts, fetchTagMeta } from '../lib/api'
import { saveMedia, sharePost, triggerHaptic } from '../lib/device'
import {
  getDetailMediaUrl,
  getMediaPosterUrl,
  hasVideoPlaybackEvidence,
  getVideoPlaybackCandidates,
  getVideoPlaybackStateKey,
} from '../lib/media'
import { getCredentialsForSource } from '../lib/providerPreferences'
import { getTagTypeDetails, sortTagsByCategory } from '../lib/tagMeta'
import { shouldAvoidInlineVideo } from '../lib/videoSupport'
import { useAppContext } from '../state/useAppContext'
import type { FeedItem, SourceId, TagMeta } from '../types'

function renderPostMedia(post: FeedItem, autoplayEnabled: boolean) {
  const treatsAsVideo = hasVideoPlaybackEvidence(post)
  const videoCandidates = treatsAsVideo ? getVideoPlaybackCandidates(post) : []

  if (treatsAsVideo && shouldAvoidInlineVideo(videoCandidates)) {
    const imageUrl = getMediaPosterUrl(post) || post.previewUrl

    if (!imageUrl) {
      return null
    }

    return (
      <a
        className="media-fallback-link"
        href={post.fileUrl || videoCandidates[0] || '#'}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={post.rawTags || `Post #${post.id}`}
          height={post.height || undefined}
          referrerPolicy="no-referrer"
          src={imageUrl}
          width={post.width || undefined}
        />
        <span>Open video</span>
      </a>
    )
  }

  if (treatsAsVideo) {
    const playbackUrl = getDetailMediaUrl(post)

    if (!playbackUrl) {
      return null
    }

    return (
      <SyncedVideo
        autoPlay={autoplayEnabled}
        controls
        defaultMuted={autoplayEnabled}
        debugLabel={post.source === 'realbooru' ? `page:${post.id}` : undefined}
        fallbackSources={videoCandidates}
        height={post.height || undefined}
        key={getVideoPlaybackStateKey(post)}
        loop={autoplayEnabled}
        poster={getMediaPosterUrl(post) || undefined}
        playsInline
        preload="metadata"
        src={playbackUrl}
        width={post.width || undefined}
      />
    )
  }

  const imageUrl = getDetailMediaUrl(post)

  if (!imageUrl) {
    return null
  }

  return (
    <img
      alt={post.rawTags || `Post #${post.id}`}
      height={post.height || undefined}
      referrerPolicy="no-referrer"
      src={imageUrl}
      width={post.width || undefined}
    />
  )
}

export function PostPage() {
  const { postId, source: sourceParam } = useParams()
  const {
    preferences,
    savedIds,
    mutedTags,
    savePost,
    unsavePost,
    hidePost,
    recordDownload,
    recordViewedPost,
    toggleMutedTag,
  } = useAppContext()
  const source = (sourceParam ?? 'rule34') as SourceId
  const credentials = getCredentialsForSource(preferences, source)

  const [post, setPost] = useState<FeedItem | null>(null)
  const [relatedPosts, setRelatedPosts] = useState<FeedItem[]>([])
  const [tagMeta, setTagMeta] = useState<Map<string, TagMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!postId) {
      return
    }

    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)

      try {
        const [loadedPost] = await fetchPosts({
          source,
          credentials,
          id: Number(postId),
          limit: 1,
        })

        if (!loadedPost) {
          throw new Error('Post not found.')
        }

        if (cancelled) {
          return
        }

        setPost(loadedPost)
        await recordViewedPost(loadedPost)

        const related = await fetchPosts({
          source,
          credentials,
          limit: 9,
          query: {
            includeTags: loadedPost.tags.slice(0, 2),
            excludeTags: [...mutedTags],
          },
        })

        if (!cancelled) {
          setRelatedPosts(related.filter((item) => item.id !== loadedPost.id))
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : 'Could not load post.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [credentials, mutedTags, postId, recordViewedPost, source])

  useEffect(() => {
    if (!post) {
      return
    }

    let cancelled = false
    setTagMeta(new Map())

    void fetchTagMeta({ source: post.source, credentials, tags: post.tags }).then((next) => {
      if (!cancelled) {
        setTagMeta(next)
      }
    }).catch(() => {
      if (!cancelled) {
        setTagMeta(new Map())
      }
    })

    return () => {
      cancelled = true
    }
  }, [credentials, post])

  if (loading) {
    return <div className="status-banner">Loading post...</div>
  }

  if (error || !post) {
    return <div className="status-banner error">{error ?? 'Post unavailable.'}</div>
  }

  const saved = savedIds.has(post.storageKey)
  const sortedTags = sortTagsByCategory(post.tags, tagMeta)

  const handleSave = async () => {
    if (saved) {
      await unsavePost(post.storageKey)
    } else {
      triggerHaptic(preferences.hapticsEnabled)
      await savePost(post)
    }
  }

  const handleDownload = async () => {
    triggerHaptic(preferences.hapticsEnabled, [14, 18, 12])
    await saveMedia(post, preferences.preferShareOnMobile)
    await recordDownload(post)
  }

  const handleHide = async () => {
    if (!window.confirm('Hide this post from local results?')) {
      return
    }

    await hidePost(post)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Post #{post.id}</h1>
          <p className="muted">{sortedTags.slice(0, 3).join(', ') || 'Media detail'}</p>
        </div>
      </section>

      <div className="media-layout">
        <section className="media-panel">
          <div className="media-frame">{renderPostMedia(post, preferences.autoplayEnabled)}</div>
        </section>

        <aside className="post-sidebar">
          <section className="sidebar-panel">
            <div className="detail-actions">
              <button className="button-primary" onClick={() => void handleSave()} type="button">
                {saved ? <BookmarkCheck aria-hidden="true" size={16} /> : <Bookmark aria-hidden="true" size={16} />}
                <span>{saved ? 'Saved' : 'Save'}</span>
              </button>
              <button className="button-secondary" onClick={() => void handleDownload()} type="button">
                <Download aria-hidden="true" size={16} />
                <span>Download</span>
              </button>
              <button className="button-secondary" onClick={() => void sharePost(post)} type="button">
                <Share2 aria-hidden="true" size={16} />
                <span>Share</span>
              </button>
              <button className="button-danger" onClick={() => void handleHide()} type="button">
                <EyeOff aria-hidden="true" size={16} />
                <span>Hide</span>
              </button>
            </div>
          </section>

          <section className="sidebar-panel">
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Rating</div>
                <div className="stat-value">{post.rating}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Score</div>
                <div className="stat-value">{post.score}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Owner</div>
                <div className="stat-value">{post.owner}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Comments</div>
                <div className="stat-value">{post.commentCount}</div>
              </div>
            </div>
            {post.sourceUrl ? (
              <a className="button-secondary" href={post.sourceUrl} rel="noreferrer" target="_blank">
                Source
              </a>
            ) : null}
            <button
              className="button-secondary"
              onClick={() => void navigator.clipboard.writeText(post.rawTags)}
              type="button"
            >
              <Copy aria-hidden="true" size={16} />
              <span>Copy tags</span>
            </button>
          </section>

          <section className="sidebar-panel">
            <h3>Tags</h3>
            <div className="tag-list">
              {sortedTags.map((tag) => {
                const details = getTagTypeDetails(tagMeta.get(tag)?.type ?? 0)

                return (
                  <div className="tag-list-item" key={tag}>
                    <Link className={`tag-chip ${details.key}`} to={`/tag/${encodeURIComponent(tag)}`}>
                      <span className="tag-chip-label">{tag}</span>
                    </Link>
                    <button className="small-button" onClick={() => void toggleMutedTag(tag)} type="button">
                      {mutedTags.has(tag) ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </aside>
      </div>

      <section className="panel stack">
        <h3>Related posts</h3>
        <FeedGrid posts={relatedPosts} />
      </section>
    </div>
  )
}
