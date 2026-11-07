import { useEffect, useState } from 'react'
import CarePage from './pages/CarePage'
import OverlayPage from './pages/OverlayPage'

// Hash routing keeps the stream overlay simple and works behind any path prefix:
//   /#overlay  -> OBS browser source view
//   /          -> the care page
export default function App() {
  const [route, setRoute] = useState<'main' | 'overlay'>('main')

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      setRoute(hash.startsWith('overlay') ? 'overlay' : 'main')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  return route === 'overlay' ? <OverlayPage /> : <CarePage />
}
