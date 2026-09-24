import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AppBoundary } from './lib/lazy-view'

// Nothing heavy is imported here on purpose. Monaco and xterm are several
// megabytes between them and neither is needed to draw the window, so each is
// fetched by the component that uses it — the editor when a file is opened,
// the terminal when the panel is. Both also point themselves at the copies
// bundled with the app, so nothing ever reaches for a CDN.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
)
