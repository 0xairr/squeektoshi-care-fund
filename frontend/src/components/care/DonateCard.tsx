import { useState } from 'react'
import { BTN, INPUT_SHELL, Panel, VOICE } from './Card'
import { TxNote } from './TxNote'
import { useCare, useConfig } from '../../lib/hooks'
import { parseUnits18 } from '../../lib/swap'
import { careHoursLine } from '../../lib/format'
import { useTx } from '../../lib/useTx'

const PRESETS = ['0.005', '0.01', '0.05']

/** A donation in ETH, expressed as how much of the keeper's allowance it covers. */
function careTimeLine(eth: number | null, ethUsd: number | null, weeklyUsd: number): string | null {
  if (!eth || !ethUsd || weeklyUsd <= 0) return null
  const days = ((eth * ethUsd) / weeklyUsd) * 7
  if (days < 0.1) return null
  if (days < 2) return `about ${Math.round(days * 24)} hours of care`
  if (days < 14) return `about ${Math.round(days)} days of care`
  return `about ${(days / 7).toFixed(1)} weeks of care`
}

export function DonateCard() {
  const { data: config } = useConfig()
  const { data: care } = useCare()
  const tx = useTx()
  const [amount, setAmount] = useState('0.005')

  const vault = config?.addresses?.vault ?? null
  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'
  const closed = care?.closed ?? false
  const amountWei = parseUnits18(amount)
  const timeLine = careTimeLine(amountWei ? Number(amountWei) / 1e18 : null, care?.ethUsd?.usd ?? null, care?.weeklyUsd ?? 230.77)

  async function donate() {
    if (!vault || !amountWei) return
    await tx.run([{ label: `Donate ${amount} ETH`, tx: { to: vault, value: amountWei } }])
  }

  return (
    <Panel
      id="donate"
      className="scroll-mt-24"
      title="Donate to the vault"
    >
      <div className={INPUT_SHELL}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          aria-label="Donation in ETH"
          className="w-full bg-transparent font-display text-[32px] tabular-nums text-ink outline-none placeholder:text-muted"
          placeholder="0"
        />
        <span className="font-voice text-[13px] font-bold text-muted">ETH</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
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
        {timeLine && <span className="ml-auto font-data text-[11px] text-muted">{timeLine}</span>}
      </div>

      <p className={`mt-4 ${VOICE}`}>
        {closed
          ? 'The fund has closed and donations are off. What was left went to the hamster rescue.'
          : 'Goes straight into the CareVault. No fee is taken. A donation can push the vault past one month; the keeper is still paid the same weekly amount, so it simply lasts longer.'}
      </p>

      <button onClick={donate} disabled={!vault || closed || !amountWei || tx.busy} className={`${BTN} mt-4 w-full`}>
        {tx.busy ? 'Waiting…' : closed ? 'The fund is closed' : vault ? `Donate ${amount || '0'} ETH` : 'Not live yet'}
      </button>
      <TxNote state={tx.state} explorer={explorer} doneText="Thank you, it's in the vault." />
      {tx.state.kind === 'done' && (
        <p className="mt-2 font-voice text-[14px] font-semibold text-amber">
          {careHoursLine(amountWei ? Number(amountWei) / 1e18 : null, care?.ethUsd?.usd ?? null, care?.weeklyUsd ?? null) ?? ''}{' '}
          <a
            className="font-voice text-[13px] text-muted underline decoration-dotted underline-offset-2 hover:text-hover"
            href={`https://x.com/intent/post?text=${encodeURIComponent('I just donated to Squeektoshi’s care vault, the hamster that mines @squeekchain.')}&url=${encodeURIComponent(location.origin)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share on X
          </a>
        </p>
      )}
    </Panel>
  )
}
