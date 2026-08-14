declare global {
  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}

const SCRIPT_SRC = 'https://www.youtube.com/iframe_api'
let pending: Promise<typeof YT> | null = null

export function resetIframeApiLoaderForTests(): void {
  pending = null
}

export function loadIframeApi(): Promise<typeof YT> {
  if (pending) return pending

  pending = new Promise<typeof YT>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The YouTube IFrame API requires a browser'))
      return
    }
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT as typeof YT)
    }

    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onerror = () => reject(new Error('Failed to load the YouTube IFrame API'))
    document.head.appendChild(script)
  })

  // Let a failed load be retried rather than poisoning every later call.
  pending.catch(() => {
    pending = null
  })

  return pending
}
