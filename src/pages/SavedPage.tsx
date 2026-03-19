import { useEffect, useState } from 'react'
import { FeedGrid } from '../components/FeedGrid'
import { getLibraryItems } from '../lib/storage'
import { useAppContext } from '../state/useAppContext'
import type { LocalLibraryItem } from '../types'

export function SavedPage() {
  const { libraryVersion, hiddenIds, mutedTags } = useAppContext()
  const [items, setItems] = useState<LocalLibraryItem[]>([])

  useEffect(() => {
    void getLibraryItems('saved').then(setItems)
  }, [libraryVersion])

  const visibleItems = items.filter(
    (item) => !hiddenIds.has(item.id) && !item.tags.some((tag) => mutedTags.has(tag)),
  )

  return (
    <div className="page app-feed-page">
      {visibleItems.length > 0 ? (
        <FeedGrid posts={visibleItems} />
      ) : (
        <section className="empty-state">
          <strong>No favourites yet</strong>
          <span className="muted">Save posts from the feed and they will appear here.</span>
        </section>
      )}
    </div>
  )
}
