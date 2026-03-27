import type { FeedItem, SourceId } from '../types'

export function getPostPath(source: SourceId, postId: number) {
  return `/post/${source}/${postId}`
}

export function getPostPathForItem(post: Pick<FeedItem, 'id' | 'source'>) {
  return getPostPath(post.source, post.id)
}
