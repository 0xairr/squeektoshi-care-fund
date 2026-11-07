import type { ReactNode } from 'react'
import { BTN_PRIMARY, Mark } from './Card'

const NAV: Array<[string, string]> = [
  ['#buy', 'Trade'],
  ['#vault', 'Vault'],
  ['#burn', 'Burn'],
  ['#vote', 'Vote'],
  ['#airdrop', 'Airdrop'],
  ['#why', 'Why care'],
  ['#how', 'How it works'],
]

/** The sticky top bar. Pure markup, so the prerendered page (entry-server.tsx) shows the same bar the app does. */
export function SiteHeader({ name, ticker, connect }: { name: string; ticker: string; connect: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b-[3px] border-edge bg-paper">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="#" className="flex min-w-0 items-center gap-3">
          <Mark className="h-9 w-9" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-display text-[17px] leading-none text-ink sm:text-[21px]">{name}</span>
            <span className="font-voice text-[12px] font-semibold text-muted">${ticker} on Sepolia</span>
          </span>
        </a>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Sections">
          {NAV.map(([href, text]) => (
            <a key={href} href={href} className="font-voice text-[15px] font-extrabold text-ink2 transition-colors hover:text-hover">
              {text}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {connect}
          <span className="hidden lg:inline-flex">
            <a href="#buy" className={`${BTN_PRIMARY} min-h-[42px] px-5`}>
              Buy ${ticker}
            </a>
          </span>
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] lg:hidden" aria-label="Sections">
        {NAV.map(([href, text]) => (
          <a
            key={href}
            href={href}
            className="shrink-0 rounded-full border-2 border-edge bg-card px-3 py-1 font-voice text-[13px] font-extrabold text-ink hover:text-hover"
          >
            {text}
          </a>
        ))}
      </nav>
    </header>
  )
}
