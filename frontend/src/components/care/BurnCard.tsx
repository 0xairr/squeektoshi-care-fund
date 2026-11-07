import { BTN, LABEL, LedgerRow, Panel, VOICE } from './Card'
import { TxNote } from './TxNote'
import { useBurnPlan, useCare, useConfig } from '../../lib/hooks'
import { fmtEth, fmtTokenAmount, fmtUsd, shortAddr } from '../../lib/format'
import { buildBurnTx } from '../../lib/swap'
import { useTx } from '../../lib/useTx'

/** The burn side of the fee: what has been bought on the pool and destroyed. */
export function BurnCard() {
  const { data: care } = useCare()
  const { data: config } = useConfig()
  const burn = care?.burn ?? null
  const wired = burn?.wired ?? false
  const pending = burn?.pendingEth ?? 0
  const minEth = burn?.minEthToBurn ?? config?.burn?.minEthToBurn ?? 0.005
  const { data: plan } = useBurnPlan(wired && pending >= minEth)
  const tx = useTx()

  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'
  const ticker = config?.ticker ?? 'CARE'
  const burnAddress = burn?.burnAddress ?? config?.burn?.burnAddress ?? '0x000000000000000000000000000000000000dEaD'
  const route = care?.routing?.mode ?? 'care'
  const last = burn?.recent?.[0] ?? null

  async function burnNow() {
    if (!plan?.ready || !plan.burner || !plan.ethInWei || !plan.minTokensOutWei) return
    await tx.run([
      { label: 'Burn', tx: buildBurnTx(plan.burner, BigInt(plan.ethInWei), BigInt(plan.minTokensOutWei)) },
    ])
  }

  const burnLabel = !wired
    ? 'Not live yet'
    : tx.busy
      ? 'Waiting…'
      : pending < minEth
        ? `Next burn at ${fmtEth(minEth, 3)} waiting`
        : plan?.ready
          ? `Burn ${fmtEth(Number(plan.ethInWei) / 1e18, 4)} now`
          : plan?.reason === 'pool_too_thin'
            ? 'The pool is too thin to burn right now'
            : 'Checking the pool…'

  return (
    <Panel id="burn" className="scroll-mt-24" title="Buyback & burn">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={`${LABEL} mb-2`}>${ticker} burned</div>
          <div className="font-display text-[46px] leading-none text-amber tabular-nums">
            {!wired || burn?.burnedTokens === undefined ? '0' : fmtTokenAmount(burn.burnedTokens)}
          </div>
          <div className="mt-2 font-voice text-[12.5px] text-muted">held by {shortAddr(burnAddress)}, an address with no key</div>
        </div>
        <div className="text-right">
          <div className={`${LABEL} mb-2`}>Fee goes to</div>
          <div className="font-display text-[22px] leading-none text-ink">
            {route === 'burn' ? 'the burn' : 'the vault'}
          </div>
          <div className="mt-2 font-voice text-[12.5px] text-muted">
            {route === 'burn' ? 'the vault is full' : care?.routing?.shortfallUsd != null ? `${fmtUsd(care.routing.shortfallUsd, { decimals: 0 })} until it is full` : 'until it holds a month'}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-2 border-t border-rule pt-4">
        <LedgerRow label="Waiting to be spent" value={wired ? fmtEth(pending, 5) : '—'} />
        <LedgerRow label="Burns so far" value={wired ? `${burn?.burnCount ?? 0}` : '—'} hint={burn?.burnedEth ? `${fmtEth(burn.burnedEth, 4)} spent` : undefined} />
        {last && <LedgerRow label="Last burn" value={`${fmtTokenAmount(last.tokensBurned)} ${ticker}`} hint={`block ${last.blockNumber}`} />}
        {care?.totals && (
          <LedgerRow
            label="All fees so far"
            value={fmtEth(care.totals.feeEth, 4)}
            hint={`${fmtEth(care.totals.toCareEth, 3)} to care, ${fmtEth(care.totals.toBurnEth, 3)} to burn`}
          />
        )}
      </div>

      <button onClick={burnNow} disabled={!plan?.ready || tx.busy} className={`${BTN} mt-4 w-full`}>
        {burnLabel}
      </button>
      <TxNote state={tx.state} explorer={explorer} doneText={`$${ticker} bought and burned.`} />

      <p className={`mt-4 border-t border-rule pt-4 ${VOICE}`}>
        The burner spends its ETH on ${ticker} in the same pool and sends what it buys to {shortAddr(burnAddress)}. Anyone
        can press burn; the ETH can only ever leave as a buy. The buyback pays no fee, and a burn won&apos;t go through if it
        would buy at more than {(burn?.maxSlippageBps ?? 300) / 100}% under the current price.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a
          href={`${explorer}/address/${burnAddress}`}
          target="_blank"
          rel="noreferrer"
          className="font-voice text-[13px] font-semibold text-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-hover"
        >
          Burn address on Etherscan
        </a>
        {burn?.burner && (
          <a
            href={`${explorer}/address/${burn.burner}`}
            target="_blank"
            rel="noreferrer"
            className="font-voice text-[13px] font-semibold text-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-hover"
          >
            Burner contract on Etherscan
          </a>
        )}
      </div>
    </Panel>
  )
}
