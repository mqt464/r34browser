interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface ImportMetaEnv {
  readonly VITE_REALBOORU_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
