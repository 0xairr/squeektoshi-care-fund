import { useState, type ReactNode } from 'react'
import { Hero } from '../components/care/Hero'
import { StatusStrip } from '../components/care/StatusStrip'
import { VaultGauge } from '../components/care/VaultGauge'
import { WheelCard } from '../components/care/WheelCard'
import { TradeCard } from '../components/care/TradeCard'
import { DonateCard } from '../components/care/DonateCard'
import { PayoutsTable } from '../components/care/PayoutsTable'
import { RecentTrades } from '../components/care/RecentTrades'
import { WhyCare } from '../components/care/WhyCare'
import { BurnCard } from '../components/care/BurnCard'
import { MoneyFlow } from '../components/care/MoneyFlow'
import { VoteCard } from '../components/care/VoteCard'
import { ClaimCard } from '../components/care/ClaimCard'
import { BTN_PRIMARY, LABEL, Panel, SectionHeading } from '../components/care/Card'
import { SiteHeader } from '../components/care/SiteHeader'
import { useCare, useConfig } from '../lib/hooks'
import { SITE } from '../lib/site'
import { shortAddr } from '../lib/format'
import { useOpenConnect } from '../lib/wallet'
import { ConnectButton } from '../components/care/Connect'

function AddressRow({ label, address, explorer, note }: { label: string; address: string | null; explorer?: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  if (!address) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-[4px] border border-dashed border-edge px-3 py-2.5">
        <span className={LABEL}>{label}</span>
        <span className="text-right font-voice text-[12.5px] text-muted">{note ?? 'set at deploy'}</span>
      </div>
    )
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(address as string)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable; the explorer link still works */
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-edge px-3 py-2.5">
      <span className={LABEL}>{label}</span>
      <span className="flex items-center gap-3">
        <a
          className="font-data text-[11px] text-ink underline decoration-dotted underline-offset-2 hover:text-hover"
          href={explorer ? `${explorer}/address/${address}` : undefined}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddr(address)}
        </a>
        <button onClick={copy} className="font-data text-[11px] text-muted hover:text-hover" aria-label={`Copy ${label} address`}>
          {copied ? 'copied' : 'copy'}
        </button>
      </span>
    </div>
  )
}

export default function CarePage() {
  const { data: config } = useConfig()
  const { data: care } = useCare()
  const name = config?.name ?? SITE.name
  const ticker = config?.ticker ?? SITE.ticker
  const wired = care?.wired ?? false
  const target = care?.targetUsd ?? 1000
  const explorer = config?.explorer
  const openConnect = useOpenConnect()

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader name={name} ticker={ticker} connect={<ConnectButton onOpen={openConnect} />} />

      <Hero />

      <main className="mx-auto max-w-[1240px] px-4 pb-28 sm:px-6 lg:pb-16">
        <section id="vault" className="mt-8 grid scroll-mt-28 items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <VaultGauge />
          <StatusStrip />
        </section>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="space-y-5">
            <TradeCard />
            <DonateCard />
          </div>
          <div className="space-y-5">
            <BurnCard />
            <WheelCard />
          </div>
        </div>

        <SectionHeading id="holders" title="For holders" />

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <VoteCard />
          <ClaimCard />
        </div>

        <WhyCare />

        <SectionHeading id="how" title="How the money moves">
          The fee never switches off. It goes to Squeektoshi&apos;s vault first, then to the burn.
        </SectionHeading>

        <MoneyFlow />

        <div className="mt-5">
          <SafeByDesign />
        </div>

        <div id="history" className="mt-8 grid scroll-mt-28 items-start gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <PayoutsTable />
          <RecentTrades />
        </div>

        <div className="mt-8 max-w-[760px]">
          <Faq ticker={ticker} hook={config?.addresses?.hook ?? null} explorer={explorer} />
        </div>

        <footer className="mt-14 border-t border-edge pt-8">
          <div className={`${LABEL} mb-3`}>Contracts</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <AddressRow label={`$${ticker} token`} address={config?.addresses?.token ?? null} explorer={explorer} />
            <AddressRow label="CareVault" address={config?.addresses?.vault ?? null} explorer={explorer} />
            <AddressRow label="Swap hook" address={config?.addresses?.hook ?? null} explorer={explorer} />
            <AddressRow label="Buyback burner" address={care?.burn?.burner ?? null} explorer={explorer} />
            <AddressRow label="Allowance ballot" address={config?.addresses?.ballot ?? null} explorer={explorer} />
            <AddressRow label="Squeek airdrop" address={config?.addresses?.airdrop ?? null} explorer={explorer} />
            <AddressRow
              label="Keeper"
              address={config?.addresses?.keeper ?? null}
              explorer={explorer}
              note="the Squeekchain team's wallet; launch waits for it"
            />
            <AddressRow label="Hamster rescue" address={config?.addresses?.rescue ?? null} explorer={explorer} note="gets what is left at the end" />
          </div>

          <p className="mt-6 max-w-[80ch] font-voice text-[12.5px] leading-[1.7] text-muted">
            A community project, not made or run by Squeekchain. Squeektoshi&apos;s wheel data comes from SqueekCore on
            Sepolia and the Squeekchain API. Sepolia testnet: test ETH only. Stream overlay for OBS at{' '}
            <a className="underline decoration-dotted underline-offset-2 hover:text-hover" href="#overlay">
              /#overlay
            </a>
            .
          </p>
        </footer>
      </main>

      {/* one-thumb buy on phones */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-[3px] border-edge bg-sun px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[22px] leading-none text-ink">
              {wired ? `${(care?.progressPct ?? 0).toFixed(0)}% full` : 'Launching soon'}
            </div>
            <div className="mt-1 truncate font-voice text-[12px] font-semibold text-muted">
              {wired ? `vault of $${Math.round(target).toLocaleString('en-US')}` : `$${Math.round(target).toLocaleString('en-US')} a month of care`}
            </div>
          </div>
          <a href="#buy" className={`${BTN_PRIMARY} px-5`}>
            Buy ${ticker}
          </a>
        </div>
      </div>
    </div>
  )
}

const SAFE: Array<[string, string]> = [
  ['The fee is fixed', "The 5% is written into the contracts. The allowance moves only by a holders' vote, between $300 and $1,000 a month."],
  ['Nobody owns it', 'No owner, no admin key, no upgrade. The deployer has no special power after launch.'],
  ['Liquidity is locked', 'The liquidity position is minted to a dead address at launch, so it can never be pulled.'],
  ['No team tokens', '93% went into the pool at launch and 7% to Squeek holders. No team wallet, no presale, no minting later.'],
]

function SafeByDesign() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {SAFE.map(([title, body]) => (
        <div key={title} className="rounded-[20px] border-[2.5px] border-edge bg-card p-4">
          <div className="font-display text-[19px] leading-tight text-ink">{title}</div>
          <p className="mt-1.5 font-voice text-[13.5px] leading-[1.5] text-ink2">{body}</p>
        </div>
      ))}
    </div>
  )
}

function Faq({ ticker, hook, explorer }: { ticker: string; hook: string | null; explorer?: string }) {
  const items: Array<[string, ReactNode]> = [
    [
      'Seeing a hook warning on Uniswap?',
      <>
        Uniswap flags every v4 pool that uses a hook. Ours takes the 5% fee and nothing else, and its source is{' '}
        {hook && explorer ? (
          <a
            className="underline decoration-dotted underline-offset-2 hover:text-hover"
            href={`https://sourcify.dev/#/lookup/${hook}`}
            target="_blank"
            rel="noreferrer"
          >
            verified on Sourcify
          </a>
        ) : (
          'public once it is deployed'
        )}
        . Trades on this page go through Uniswap&apos;s own router.
      </>,
    ],
    [
      'Who gets the money?',
      'The keeper, the Squeekchain team that looks after Squeektoshi, is paid a week of the allowance holders voted for: $230.77 at $1,000 a month. Nobody else can take money out of the vault.',
    ],
    [
      'Why does a first sell ask for approvals?',
      `Uniswap's router moves $${ticker} through Permit2. You allow Permit2 once, and the router for 30 days. Your wallet shows each step, and the site never holds your tokens.`,
    ],
    ['What happens when the vault is full?', `The 5% buys $${ticker} back on the pool and burns it, until the next weekly payout opens a gap.`],
    ['What if a week can’t be paid?', 'It stays owed. The next payout settles every week the vault can cover, so the keeper never loses one.'],
    ['What if the fund ever ends?', 'The keeper or the rescue can retire it. It keeps paying for 30 more days, then what is left goes to the rescue and every fee after that is burned.'],
    ['Is this real money?', 'No. It runs on the Sepolia testnet with test ETH.'],
  ]
  return (
    <Panel title="Questions">
      <div className="divide-y divide-rule">
        {items.map(([q, a]) => (
          <details key={q} className="group py-3 first:pt-0 last:pb-0">
            <summary className="cursor-pointer list-none font-voice text-[14.5px] font-bold text-ink">
              <span className="mr-2 inline-block text-amber transition-transform group-open:rotate-90">›</span>
              {q}
            </summary>
            <p className="mt-2 pl-5 font-voice text-[13.5px] leading-[1.55] text-ink2">{a}</p>
          </details>
        ))}
      </div>
    </Panel>
  )
}
