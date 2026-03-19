import { Navigate, useParams } from 'react-router-dom'
import type { SearchNavigationState } from '../types'

export function TagRedirectPage() {
  const { tag = '' } = useParams()
  const decodedTag = decodeURIComponent(tag)

  return (
    <Navigate
      replace
      state={{ pendingQuery: decodedTag } satisfies SearchNavigationState}
      to="/search"
    />
  )
}
