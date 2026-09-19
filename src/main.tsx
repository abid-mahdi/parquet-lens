import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/app.css'
import { applyTheme, preferredTheme } from './theme'

applyTheme(preferredTheme())

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
