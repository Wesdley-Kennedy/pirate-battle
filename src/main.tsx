import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Error states must be immediate and deterministic (tests select
      // the failure scenario on purpose); invalidation after registering
      // a match keeps the two tabs fresh, so background retries add
      // nothing here.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
})

/**
 * The ranking/history API is simulated with MSW in EVERY environment —
 * development, tests and the published build (the challenge has no real
 * backend). The app only renders once interception is active, so the
 * first queries can never slip through to the network.
 */
async function enableMocking(): Promise<void> {
  try {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledFrame: 'bypass', // asset/page requests pass straight through
      quiet: true,
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    })
  } catch (error) {
    // Service workers can be unavailable (private mode, blocked). The
    // game and options never depend on the network — only the boards
    // will show their error state — so the app must still boot.
    console.warn('API mocking unavailable, continuing without it', error)
  }
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root not found')
}

void enableMocking().then(() => {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
