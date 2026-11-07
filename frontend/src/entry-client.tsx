import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { ConnectProvider } from './components/care/Connect'
import { config } from './lib/wagmi'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      staleTime: 10_000,
    },
  },
})

// The page arrives with the header and hero prerendered (entry-server.tsx). React replaces that markup
// when it first commits, so the prerendered page stays on screen until the app is ready to draw.
const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {/* No reconnect on load: the wallet connects only when the visitor presses Connect. */}
      <WagmiProvider config={config} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <ConnectProvider>
            <App />
          </ConnectProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </StrictMode>
)
