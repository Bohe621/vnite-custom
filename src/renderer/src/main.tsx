import '~/styles/globals.css'

import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './app/router'
import { TooltipProvider } from '@ui/tooltip'
import { i18nInit } from './utils/i18n'

// In dev, mark the window so it's distinguishable from installed builds in the
// taskbar. The frameless window's taskbar label follows document.title, and nothing
// else in the app changes it, so setting it once here is enough. (No-op in packaged builds.)
if (import.meta.env.DEV) {
  document.title = 'Vnite (Dev)'
}

i18nInit().then(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
})
