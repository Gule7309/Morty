import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import './styles/global.css'

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (window.confirm('Pocket PDF 有新版本，現在重新載入嗎？')) {
      void updateServiceWorker(true)
    }
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
