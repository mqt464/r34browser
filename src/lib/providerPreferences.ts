import type { ApiCredentials, SourceId, UserPreferences } from '../types'

export function getCredentialsForSource(
  preferences: UserPreferences,
  source: SourceId,
): ApiCredentials | undefined {
  if (source === 'rule34') {
    return preferences.rule34Credentials
  }

  return undefined
}

export function hasRequiredCredentials(preferences: UserPreferences, source: SourceId) {
  const credentials = getCredentialsForSource(preferences, source)
  if (!credentials) {
    return true
  }

  return Boolean(credentials.userId && credentials.apiKey)
}
