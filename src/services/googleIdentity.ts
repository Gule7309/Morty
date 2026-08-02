interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleIdentityApi {
  initialize: (options: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }) => void
  renderButton: (
    parent: HTMLElement,
    options: {
      type: 'standard'
      theme: 'outline'
      size: 'large'
      text: 'signin_with'
      shape: 'rectangular'
      locale: 'zh-TW'
      width: number
    },
  ) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } }
  }
}

let scriptPromise: Promise<void> | undefined

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.id) {
    return Promise.resolve()
  }
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pocket-pdf-google-identity]',
    )
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Google 登入元件載入失敗。')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client?hl=zh-TW'
    script.async = true
    script.defer = true
    script.dataset.pocketPdfGoogleIdentity = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => reject(new Error('Google 登入元件載入失敗。')),
      { once: true },
    )
    document.head.append(script)
  })
  return scriptPromise
}

export function renderGoogleSignIn(
  element: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void,
): void {
  const identity = window.google?.accounts.id
  if (!identity) {
    throw new Error('Google 登入元件尚未準備完成。')
  }
  identity.initialize({
    client_id: clientId,
    callback(response) {
      if (response.credential) {
        onCredential(response.credential)
      }
    },
  })
  element.replaceChildren()
  identity.renderButton(element, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    locale: 'zh-TW',
    width: Math.min(340, Math.max(220, element.clientWidth || 320)),
  })
}

export function signOutGoogleIdentity(): void {
  window.google?.accounts.id.disableAutoSelect()
}

