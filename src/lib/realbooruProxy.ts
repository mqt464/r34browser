const DEFAULT_REALBOORU_PROXY_URL =
  import.meta.env.VITE_REALBOORU_PROXY_URL?.trim() || 'https://corsproxy.io/?url='

let currentRealbooruProxyUrl = DEFAULT_REALBOORU_PROXY_URL

export function normalizeRealbooruProxyUrl(value: string | undefined) {
  return value?.trim() || DEFAULT_REALBOORU_PROXY_URL
}

export function setRealbooruProxyUrl(value: string | undefined) {
  currentRealbooruProxyUrl = normalizeRealbooruProxyUrl(value)
}

export function getRealbooruProxyUrl() {
  return currentRealbooruProxyUrl
}

export function shouldProxyRealbooruMedia() {
  const proxyUrl = getRealbooruProxyUrl()

  try {
    const parsed = new URL(proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', 'https://example.com') : proxyUrl)
    return parsed.hostname.toLowerCase() !== 'corsproxy.io'
  } catch {
    return !proxyUrl.toLowerCase().includes('corsproxy.io')
  }
}

export function buildProxiedUrl(targetUrl: string) {
  const proxyUrl = getRealbooruProxyUrl()

  if (proxyUrl.includes('{url}')) {
    return proxyUrl.replaceAll('{url}', encodeURIComponent(targetUrl))
  }

  return `${proxyUrl}${encodeURIComponent(targetUrl)}`
}
