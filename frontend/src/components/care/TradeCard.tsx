import { useState } from 'react'
import { BTN_PRIMARY, INPUT_SHELL, LABEL, LedgerRow, Panel } from './Card'
import { TxNote } from './TxNote'
import { useCare, useConfig, useQuote, useWallet } from '../../lib/hooks'
import {
  applySlippage,
  buildBuyTx,
  buildPermit2ApproveTx,
  buildSellTx,
  buildTokenApproveTx,
  formatUnits18,
  parseUnits18,
} from '../../lib/swap'
import { careHoursLine, fmtEth, fmtTokens, fmtUsd } from '../../lib/format'
import { useAccount, useOpenConnect } from '../../lib/wallet'
import { useTx, type TxStep } from '../../lib/useTx'

const BUY_PRESETS = ['0.01', '0.05', '0.1']
const SLIPPAGE = [0.5, 1, 3]
// Leave this much ETH behind on "max" so the buy itself can pay its gas.
const GAS_RESERVE = 5_000_000_000_000_000n // 0.005 ETH

type Side = 'buy' | 'sell'

interface Plan {
  key: 'approve' | 'permit' | 'swap'
  title: string
  why: string
}

export function TradeCard() {
  const { data: config } = useConfig()
  const { data: care } = useCare()
  const { account } = useAccount()
  const openConnect = useOpenConnect()
  const { data: wallet } = useWallet(account)
  const tx = useTx()

  const [side, setSide] = useState<Side>('buy')
  const [amounts, setAmounts] = useState<Record<Side, string>>({ buy: '0.01', sell: '' })
  const [slippage, setSlippage] = useState(1)
  const [lastFeeEth, setLastFeeEth] = useState<number | null>(null)
  // The steps a running sell was started with, so the list does not reshuffle as approvals land.
  const [frozenPlan, setFrozenPlan] = useState<Plan[] | null>(null)

  const amount = amounts[side]
  const setAmount = (v: string) => setAmounts((a) => ({ ...a, [side]: v.replace(/[^0-9.]/g, '') }))

  const ticker = config?.ticker ?? 'CARE'
  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'
  const pool = config?.pool ?? null
  const router = config?.addresses?.router ?? null
  const permit2 = config?.addresses?.permit2 ?? null
  const token = config?.addresses?.token ?? null
  const live = Boolean(config?.wired?.pool && pool && router)
  const price = care?.ethUsd?.usd ?? null

  const amountWei = parseUnits18(amount)
  const { data: quote, isFetching } = useQuote(side, amount, live && amountWei !== null)
  const outWei = quote?.ok && quote.wired && quote.side === side && quote.amountOutWei ? BigInt(quote.amountOutWei) : null
  const minOutWei = outWei !== null ? applySlippage(outWei, slippage) : null
  const impactPct = quote?.ok && quote.side === side && typeof quote.impactBps === 'number' ? quote.impactBps / 100 : null

  const ethBal = wallet?.ethWei ? BigInt(wallet.ethWei) : null
  const tokenBal = wallet?.tokenWei ? BigInt(wallet.tokenWei) : null
  const balance = side === 'buy' ? ethBal : tokenBal
  const tooMuch = amountWei !== null && balance !== null && amountWei > balance

  const feeBps = care?.feeBps ?? 500
  const feePct = feeBps / 100
  const route = care?.routing?.mode ?? 'care'
  // Buy: 5% of the ETH paid. Sell: 5% of the gross ETH out, i.e. out / 0.95 * 0.05.
  const feeWei =
    side === 'buy'
      ? amountWei
        ? (amountWei * BigInt(feeBps)) / 10_000n
        : null
      : outWei !== null
        ? (outWei * BigInt(feeBps)) / BigInt(10_000 - feeBps)
        : null
  const ethValue = side === 'buy' ? (amountWei ? Number(amountWei) / 1e18 : null) : outWei !== null ? Number(outWei) / 1e18 : null

  // A first sell needs two one-time approvals before the sell itself.
  const toPermit2 = wallet?.tokenAllowanceToPermit2Wei ? BigInt(wallet.tokenAllowanceToPermit2Wei) : 0n
  const p2 = wallet?.permit2
  const needApprove = side === 'sell' && (!amountWei || toPermit2 < amountWei)
  const needPermit =
    side === 'sell' && !(p2 && amountWei && BigInt(p2.amountWei) >= amountWei && p2.expiration > Date.now() / 1000 + 600)
  const plan: Plan[] = [
    ...(needApprove
      ? [{ key: 'approve' as const, title: `Allow $${ticker}`, why: 'Lets Uniswap’s Permit2 contract move your $CARE when you sell. One time.' }]
      : []),
    ...(needPermit
      ? [{ key: 'permit' as const, title: 'Allow the Uniswap router', why: 'Lets the router use that permission for 30 days. No tokens move.' }]
      : []),
    { key: 'swap' as const, title: `Sell $${ticker}`, why: 'The swap itself. You get ETH; the 5% fee is taken from it.' },
  ]

  function setMax() {
    if (balance === null) return
    const max = side === 'buy' ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance
    setAmount(formatUnits18(max, side === 'buy' ? 6 : 4))
  }

  async function submit() {
    if (!pool || !router || !amountWei || minOutWei === null) return
    if (!account) return openConnect()
    const from = account
    const fee = feeWei !== null ? Number(feeWei) / 1e18 : null
    if (side === 'buy') {
      if (await tx.run([{ label: `Buy $${ticker}`, tx: buildBuyTx(router, pool, amountWei, minOutWei, from) }])) setLastFeeEth(fee)
      return
    }
    if (!token || !permit2) return
    setFrozenPlan(plan)
    const steps: TxStep[] = plan.map((p) => ({
      label: p.title,
      tx:
        p.key === 'approve'
          ? buildTokenApproveTx(token, permit2)
          : p.key === 'permit'
            ? buildPermit2ApproveTx(permit2, token, router)
            : buildSellTx(router, pool, amountWei, minOutWei),
    }))
    if (await tx.run(steps)) {
      setLastFeeEth(fee)
      setAmounts((a) => ({ ...a, sell: '' }))
    }
  }

  const buttonText = !live
    ? 'Not live yet'
    : tx.busy
      ? 'Waiting…'
      : !account
        ? 'Connect wallet'
        : !amountWei
          ? 'Enter an amount'
          : tooMuch
            ? `Not enough ${side === 'buy' ? 'ETH' : `$${ticker}`}`
            : outWei === null
              ? isFetching
                ? 'Getting a quote…'
                : 'No quote for this amount'
              : side === 'buy'
                ? `Buy $${ticker}`
                : plan.length > 1
                  ? `Start: ${plan[0].title.toLowerCase()}`
                  : `Sell $${ticker}`

  const disabled = !live || tx.busy || (Boolean(account) && (!amountWei || tooMuch || outWei === null))
  const dash = '—'
  const shownPlan = frozenPlan ?? plan
  const activeStep =
    tx.state.kind === 'signing' || tx.state.kind === 'mining'
      ? tx.state.step
      : tx.state.kind === 'done' && frozenPlan
        ? shownPlan.length + 1
        : 0
  const hours = careHoursLine(lastFeeEth, price, care?.weeklyUsd ?? null)
  const shareText = encodeURIComponent(
    `I just ${side === 'buy' ? 'bought' : 'traded'} $${ticker}. ${hours ?? 'My fee'} went to Squeektoshi, the hamster that mines @squeekchain.`
  )

  return (
    <Panel
      id="buy"
      className="scroll-mt-28"
      title={
        <span className="flex gap-1" role="tablist" aria-label="Buy or sell">
          {(['buy', 'sell'] as Side[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={side === s}
              onClick={() => {
                setSide(s)
                tx.reset()
                setLastFeeEth(null)
                setFrozenPlan(null)
              }}
              className={`rounded-[4px] px-3 py-1 font-voice text-[14px] font-bold transition-colors ${
                side === s ? 'bg-ink text-paper' : 'text-muted hover:text-hover'
              }`}
            >
              {s === 'buy' ? 'Buy' : 'Sell'} ${ticker}
            </button>
          ))}
        </span>
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={LABEL}>{side === 'buy' ? 'You pay' : 'You sell'}</span>
        {account && balance !== null && (
          <button onClick={setMax} className="font-data text-[11px] text-muted hover:text-hover">
            Max {side === 'buy' ? fmtEth(Number(balance) / 1e18, 4) : `${fmtTokens(balance)} ${ticker}`}
          </button>
        )}
      </div>
      <div className={INPUT_SHELL}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label={side === 'buy' ? 'ETH to spend' : `${ticker} to sell`}
          className="w-full bg-transparent font-display text-[32px] tabular-nums text-ink outline-none placeholder:text-muted"
          placeholder="0"
        />
        <span className="font-voice text-[13px] font-bold text-muted">{side === 'buy' ? 'ETH' : ticker}</span>
      </div>
      <div className="mt-1.5 h-4 font-data text-[11px] text-muted">
        {side === 'buy' && ethValue !== null && price ? `≈ ${fmtUsd(ethValue * price)}` : ''}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {side === 'buy' &&
          BUY_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setAmount(preset)}
              className={`rounded-[4px] border px-2.5 py-1 font-data text-[11px] tabular-nums transition-colors ${
                amount === preset
                  ? 'border-amber/50 text-amber'
                  : 'border-edge text-muted hover:border-hover hover:text-hover'
              }`}
            >
              {preset}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-2">
          <span className={LABEL}>Price slippage</span>
          <div className="flex rounded-[4px] border border-edge p-[2px]">
            {SLIPPAGE.map((s) => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                aria-pressed={slippage === s}
                className={`rounded-[2px] px-2 py-[3px] font-data text-[11px] tabular-nums transition-colors ${
                  slippage === s ? 'bg-ink text-paper' : 'text-muted hover:text-hover'
                }`}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-right font-voice text-[12px] text-muted">
        How far the price may move before your trade is cancelled. The {feePct}% fee is separate.
      </p>

      <div className="mt-3 border border-rule px-4 py-1">
        <LedgerRow
          label="You receive"
          value={
            outWei === null
              ? live && amountWei && isFetching
                ? '…'
                : dash
              : side === 'buy'
                ? `${fmtTokens(outWei)} ${ticker}`
                : fmtEth(Number(outWei) / 1e18, 5)
          }
          hint={side === 'sell' && outWei !== null && price ? fmtUsd((Number(outWei) / 1e18) * price) : undefined}
        />
        <LedgerRow
          label={`Care fee ${feePct}%`}
          value={feeWei !== null ? fmtEth(Number(feeWei) / 1e18, 6) : dash}
          tone="gold"
          hint={route === 'burn' ? 'burns $CARE' : 'to the vault'}
        />
        <LedgerRow
          label="At least"
          value={minOutWei === null ? dash : side === 'buy' ? `${fmtTokens(minOutWei)} ${ticker}` : fmtEth(Number(minOutWei) / 1e18, 5)}
          hint={`with ${slippage}% slippage`}
        />
        <LedgerRow
          label="Price impact"
          value={impactPct === null ? dash : `${impactPct < 0.01 ? '<0.01' : impactPct.toFixed(2)}%`}
          tone={impactPct !== null && impactPct > 5 ? 'gold' : 'default'}
          hint={impactPct !== null && impactPct > 5 ? 'large for this pool' : undefined}
        />
        {live && amountWei && outWei === null && quote && !quote.ok && !isFetching && (
          <p className="pb-2 font-voice text-[12.5px] text-carrot">The pool can&apos;t fill this amount. Try a smaller one.</p>
        )}
      </div>

      {side === 'sell' && live && (
        <ol className="mt-4 space-y-2" aria-label="Sell steps">
          {shownPlan.map((p, i) => {
            const n = i + 1
            const state = activeStep === 0 ? 'todo' : n < activeStep ? 'done' : n === activeStep ? 'now' : 'todo'
            return (
              <li key={p.key} className="flex gap-3">
                <span
                  className={`mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-data text-[11px] ${
                    state === 'done' ? 'bg-leaf text-paper' : state === 'now' ? 'bg-amber text-paper' : 'border border-edge text-muted'
                  }`}
                >
                  {state === 'done' ? '✓' : n}
                </span>
                <span>
                  <span className="font-voice text-[13.5px] font-bold text-ink">{p.title}</span>
                  <span className="block font-voice text-[12.5px] text-muted">{p.why}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}

      <button
        onClick={account ? submit : openConnect}
        disabled={disabled}
        className={`${BTN_PRIMARY} mt-4 w-full`}
      >
        {buttonText}
      </button>

      <TxNote state={tx.state} explorer={explorer} doneText={side === 'buy' ? 'Bought.' : 'Sold.'} />
      {tx.state.kind === 'done' && (
        <p className="mt-2 font-voice text-[14px] font-semibold text-amber">
          {route === 'burn' ? 'Your fee went to the burn.' : (hours ?? 'Your fee went to the vault.')}{' '}
          <a
            className="font-voice text-[13px] text-muted underline decoration-dotted underline-offset-2 hover:text-hover"
            href={`https://x.com/intent/post?text=${shareText}&url=${encodeURIComponent(location.origin)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share on X
          </a>
        </p>
      )}

      <p className="mt-3 font-voice text-[12.5px] leading-[1.55] text-muted">
        Trades go through Uniswap&apos;s UniversalRouter on Sepolia. Your wallet signs every step; this site never holds
        your funds or keys.
      </p>
    </Panel>
  )
}
