import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

const INSTALL_DISMISSED_KEY = 'r34browser.installDismissed'

function isStandaloneDisplayMode() {
  return window.matchMedia('(display-mode: standalone)').matches
}

export function InstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(INSTALL_DISMISSED_KEY) === '1',
  )

  useEffect(() => {
    const onPrompt = (event: Event) => {
      if (dismissed || isStandaloneDisplayMode()) {
        setInstallPrompt(null)
        return
      }

      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    const onInstalled = () => {
      setInstallPrompt(null)
      setDismissed(false)
      localStorage.removeItem(INSTALL_DISMISSED_KEY)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismissed])

  if (!installPrompt || dismissed) {
    return null
  }

  const handleInstall = async () => {
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') {
      setInstallPrompt(null)
    }
  }

  return (
    <aside className="install-banner">
      <div className="install-copy">
        <Download aria-hidden="true" size={16} />
        <strong>Install app</strong>
      </div>
      <div className="inline-actions">
        <button
          className="button-primary"
          onClick={() => void handleInstall()}
          type="button"
        >
          Install
        </button>
        <button
          className="button-secondary"
          onClick={() => {
            localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
            setInstallPrompt(null)
            setDismissed(true)
          }}
          type="button"
        >
          Hide
        </button>
      </div>
    </aside>
  )
}
