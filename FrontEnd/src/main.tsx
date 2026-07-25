import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import App from './App'
import { AnimationRuntimeProvider } from './runtime/AnimationRuntimeContext'
import './styles.css'
import { applyTheme } from './styles/theme'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnimationRuntimeProvider>
      <App />
    </AnimationRuntimeProvider>
  </StrictMode>,
)
