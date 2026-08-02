import { useEffect, useRef } from 'react'
import {
  loadGoogleIdentity,
  renderGoogleSignIn,
  signOutGoogleIdentity,
} from '../../services/googleIdentity'

interface GoogleSignInCardProps {
  authenticated: boolean
  onCredential: (credential: string) => void
  onError: (message: string) => void
  onSignOut: () => void
  clientId?: string
}

export function GoogleSignInCard({
  authenticated,
  onCredential,
  onError,
  onSignOut,
  clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID,
}: GoogleSignInCardProps) {
  const buttonHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (authenticated || !clientId || !buttonHostRef.current) {
      return
    }

    let canceled = false
    const host = buttonHostRef.current
    void loadGoogleIdentity()
      .then(() => {
        if (!canceled) {
          renderGoogleSignIn(host, clientId, onCredential)
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          onError(
            error instanceof Error
              ? error.message
              : 'Google 登入元件載入失敗。',
          )
        }
      })

    return () => {
      canceled = true
      host.replaceChildren()
    }
  }, [authenticated, clientId, onCredential, onError])

  if (authenticated) {
    return (
      <div className="cloudAuthStatus">
        <span>已連接 Pocket PDF 雲端</span>
        <button
          type="button"
          onClick={() => {
            signOutGoogleIdentity()
            onSignOut()
          }}
        >
          登出
        </button>
      </div>
    )
  }

  return (
    <div className="cloudAuth">
      <p>登入後才能上傳、查看及管理雲端 PDF。</p>
      {clientId ? (
        <div ref={buttonHostRef} className="googleSignInHost" />
      ) : (
        <p className="configurationNote">Google Sign-In 尚未設定</p>
      )}
    </div>
  )
}

