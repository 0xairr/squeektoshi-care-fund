import { renderToString } from 'react-dom/server'
import { SITE } from './lib/site'
import { BTN } from './components/care/Card'
import { SiteHeader } from './components/care/SiteHeader'
import { HeroView } from './components/care/HeroView'

// Built separately (vite build --ssr) and run once by scripts/prerender.mjs after the client build.

/** Tags for the page <head>: the Genesis verification tag, once the project id is set. */
export function head(): string {
  if (!SITE.projectId) return ''
  const id = SITE.projectId.replace(/[^A-Za-z0-9_-]/g, '')
  return `<meta name="squeekchain-project" content="${id}">`
}

/** The first paint inside #root: the same header and hero the app renders before its data arrives, so
 *  crawlers get real text and visitors see no swap when the app takes over. Pure markup only. */
export function render(): string {
  return renderToString(
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader
        name={SITE.name}
        ticker={SITE.ticker}
        connect={
          <button type="button" className={`${BTN} min-h-[38px] px-4 whitespace-nowrap`}>
            Connect wallet
          </button>
        }
      />
      <HeroView ticker={SITE.ticker} mood="asleep" rpm={null} checking days={null} launching={false} />
    </div>
  )
}
