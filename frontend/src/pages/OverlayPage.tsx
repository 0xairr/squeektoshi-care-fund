import { useEffect, useRef, useState } from 'react'
import { Mark } from '../components/care/Card'
import { useCare, useConfig, useTrades, type Trade } from '../lib/hooks'
import { fmtTokens, fmtWeiEth, shortAddr } from '../lib/format'

interface VisibleTreat extends Trade {
  key: string
  bornAt: number
}

const TTL_MS = 9000
const MAX_VISIBLE = 4
// The overlay runs for hours, so the set that de-duplicates transactions is capped.
const MAX_SEEN = 512

// `#overlay?test=1` drops a pretend treat every few seconds, so a streamer can line it up in OBS
// before there are any real buys. Test treats say so.
const TEST_EVERY_MS = 4000

function testTreat(n: number): VisibleTreat {
  return {
    txHash: `test-${n}`,
    blockNumber: 0,
    side: 'buy',
    ethWei: String(BigInt(10 + (n % 5) * 15) * 10n ** 15n),
    feeWei: String(BigInt(10 + (n % 5) * 15) * 5n * 10n ** 13n),
    tokenWei: String(BigInt(1_000_000 + n * 250_000) * 10n ** 18n),
    trader: null,
    key: `test-${n}-${Date.now()}`,
    bornAt: Date.now(),
  }
}

/** OBS browser source: every buy drops a treat on stream. Sells are not shown. */
export default function OverlayPage() {
  const testMode = typeof window !== 'undefined' && /[?&]test=1/.test(window.location.hash)
  const { data: config } = useConfig()
  const { data: care } = useCare()
  const [cursor, setCursor] = useState<number | null>(null)
  const [visible, setVisible] = useState<VisibleTreat[]>([])
  const [count, setCount] = useState(0)
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)
  const { data } = useTrades(cursor, 8000)

  const ticker = config?.ticker ?? 'CARE'
  const feePct = (care?.feeBps ?? 500) / 100
  const feeLine =
    care?.routing?.mode === 'burn' ? `${feePct}% fee burned $${ticker}` : `${feePct}% fee to Squeektoshi's care vault`

  useEffect(() => {
    const prev = document.title
    document.title = '$CARE treats overlay'
    return () => {
      document.title = prev
    }
  }, [])

  useEffect(() => {
    if (!testMode) return
    let n = 0
    const id = setInterval(() => {
      n += 1
      setVisible((prev) => [...prev, testTreat(n)].slice(-MAX_VISIBLE))
      setCount((c) => c + 1)
    }, TEST_EVERY_MS)
    return () => clearInterval(id)
  }, [testMode])

  // Transparent background for OBS.
  useEffect(() => {
    const html = document.documentElement
    const prevHtml = html.style.background
    const prevBody = document.body.style.background
    html.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      html.style.background = prevHtml
      document.body.style.background = prevBody
    }
  }, [])

  useEffect(() => {
    if (!data?.trades) return
    const fresh = data.trades.filter((t) => t.side === 'buy' && !seen.current.has(t.txHash))
    fresh.forEach((t) => seen.current.add(t.txHash))
    if (seen.current.size > MAX_SEEN) seen.current = new Set([...seen.current].slice(-MAX_SEEN))

    const now = Date.now()
    if (!primed.current) {
      primed.current = true
      // On first load show the last couple of buys so the overlay is not empty.
      const recent = fresh.slice(-2).map((t) => ({ ...t, key: t.txHash, bornAt: now }))
      if (recent.length) setVisible(recent)
    } else if (fresh.length) {
      setVisible((prev) => [...prev, ...fresh.map((t) => ({ ...t, key: t.txHash, bornAt: now }))].slice(-MAX_VISIBLE))
      setCount((c) => c + fresh.length)
    }
    if (data.latestBlock && (cursor === null || data.latestBlock > cursor)) setCursor(data.latestBlock)
  }, [data, cursor])

  useEffect(() => {
    if (!visible.length) return
    const id = setInterval(() => {
      const cutoff = Date.now() - TTL_MS
      setVisible((prev) => prev.filter((t) => t.bornAt > cutoff))
    }, 500)
    return () => clearInterval(id)
  }, [visible.length])

  const wired = data?.wired ?? config?.wired?.pool ?? false
  const keeper = config?.addresses?.keeper?.toLowerCase() ?? null
  const nameFor = (t: VisibleTreat) =>
    t.txHash.startsWith('test-')
      ? 'Test treat:'
      : !t.trader
        ? 'someone'
        : keeper && t.trader.toLowerCase() === keeper
          ? 'the keeper'
          : shortAddr(t.trader)

  return (
    <div className="fixed inset-0 overflow-hidden bg-transparent text-ink">
      <style>{`
        @keyframes treat-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes treat-fall { 0% { opacity: 0; transform: translateY(-18px) rotate(-12deg); } 25% { opacity: 1; transform: rotate(6deg); } 100% { transform: none; } }
      `}</style>

      <div className="absolute top-6 left-6 flex items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border-[2.5px] border-edge bg-card px-3 py-1.5 font-voice text-[13px] font-bold text-ink ">
          <Mark className="h-3.5 w-3.5 text-amber" />${ticker} treats
        </span>
        {count > 0 && (
          <span className="rounded-full border border-amber/40 bg-card px-3 py-1.5 font-voice text-[13px] font-bold tabular-nums text-amber ">
            {count} this stream
          </span>
        )}
      </div>

      {!wired && !testMode && (
        <div className="absolute top-1/3 left-1/2 max-w-sm -translate-x-1/2 rounded-[18px] border-[2.5px] border-edge shadow-pop-sm bg-card p-4 text-center ">
          <div className="font-voice text-[15px] font-bold text-ink">Treats start at launch</div>
          <p className="mt-2 font-voice text-[13px] leading-[1.55] font-medium text-ink2">
            Every buy of ${ticker} will drop a treat here. Add <code>?test=1</code> to this address to see how one looks.
          </p>
        </div>
      )}

      <div className="absolute bottom-16 left-10 flex flex-col gap-3">
        {visible.map((t) => (
          <div
            key={t.key}
            className="flex items-center gap-3 rounded-[18px] border-[2.5px] border-edge shadow-pop-sm bg-card px-4 py-3 "
            style={{ animation: 'treat-in 320ms ease-out' }}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-amber" style={{ animation: 'treat-fall 500ms ease-out' }} aria-hidden="true">
              <ellipse cx="12" cy="14.5" rx="8" ry="6" fill="currentColor" />
              <circle cx="9" cy="12" r="1.9" fill="#ffffff" opacity="0.45" />
            </svg>
            <div>
              <div className="font-display text-[20px] text-ink">
                {nameFor(t)} bought {fmtTokens(t.tokenWei)} ${ticker} for {fmtWeiEth(t.ethWei, 4)}
              </div>
              <div className="mt-0.5 font-voice text-[13px] font-semibold text-amber">
                {feeLine}: {fmtWeiEth(t.feeWei, 5)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
