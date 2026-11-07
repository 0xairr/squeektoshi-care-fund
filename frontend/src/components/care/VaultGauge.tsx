import { useEffect, useState } from 'react'
import { BTN, LABEL, LedgerRow, Panel } from './Card'
import { TxNote } from './TxNote'
import { useCare, useConfig } from '../../lib/hooks'
import { daysOfCare, fmtCountdown, fmtEth, fmtUsd } from '../../lib/format'
import { buildPayTx } from '../../lib/swap'
import { useTx } from '../../lib/useTx'

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** One cell per day of care the vault can hold, grouped into weeks, filled as the vault fills. */
function DayStrip({ filled, total, full }: { filled: number; total: number; full: boolean }) {
  const weeks: number[][] = []
  for (let d = 0; d < total; d++) {
    const w = Math.floor(d / 7)
    ;(weeks[w] ||= []).push(d)
  }
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: weeks.map((w) => `${w.length}fr`).join(' ') }} aria-hidden="true">
      {weeks.map((days, w) => (
        <div key={w}>
          <div className="flex gap-[3px]">
            {days.map((d) => (
              <span
                key={d}
                className="h-7 flex-1 rounded-full border-2 border-edge"
                style={{
                  background:
                    d < filled ? (full ? 'var(--color-leaf)' : 'var(--color-sun)') : 'var(--color-card2)',
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 font-voice text-[11.5px] font-semibold text-muted">
            {days.length === 7 ? `Week ${w + 1}` : `+${days.length}d`}
          </div>
        </div>
      ))}
    </div>
  )
}

export function VaultGauge() {
  const { data: care } = useCare()
  const { data: config } = useConfig()
  const now = useNow()
  const tx = useTx()

  const wired = care?.wired ?? false
  const target = care?.targetUsd ?? 1000
  const weeklyUsd = care?.weeklyUsd ?? (target * 12) / 52
  const full = care?.routing?.mode === 'burn'
  const closed = care?.closed ?? false
  const owed = care?.weeksOwed ?? 0
  const vault = config?.addresses?.vault ?? null
  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'

  const totalDays = Math.floor(target / (weeklyUsd / 7)) // $1,000 ≈ 30 days
  const days = daysOfCare(care?.balanceUsd ?? null, weeklyUsd)
  const filled = Math.min(totalDays, days ?? 0)
  const nextIn = care?.nextPayoutAt ? Date.parse(care.nextPayoutAt) - now : null

  async function pay() {
    if (!vault) return
    await tx.run([{ label: 'Pay the keeper', tx: buildPayTx(vault) }])
  }

  return (
    <Panel title="Squeektoshi's vault">
      <div className="font-display text-[56px] leading-none text-ink tabular-nums">
        {days === null ? `${totalDays} days` : `${days} ${days === 1 ? 'day' : 'days'}`}
      </div>
      <div className="mt-2 font-voice text-[14px] font-semibold text-ink2">
        {days === null
          ? `of care is what the vault holds when full (${fmtUsd(target, { decimals: 0 })})`
          : `of care in the vault (${fmtUsd(care?.balanceUsd ?? 0, { decimals: 0 })} of ${fmtUsd(target, { decimals: 0 })})`}
      </div>

      <div className="mt-5">
        <DayStrip filled={filled} total={totalDays} full={full} />
      </div>

      <p className="mt-5 font-voice text-[14px] leading-[1.5] font-medium text-ink2">
        {closed
          ? 'The fund has closed and what was left went to the hamster rescue. Every fee now buys $CARE back and burns it.'
          : full
            ? 'Full. Fees now buy $CARE back and burn it, until the next weekly payout opens a gap.'
            : `The swap fee fills this vault up to a month of care. Above that, fees buy $CARE back and burn it. Each weekly payout opens a gap that the next fees fill first.`}
      </p>

      <div className="mt-4">
        <LedgerRow
          label="Weekly payout"
          value={fmtUsd(weeklyUsd)}
          tone="gold"
          hint={care?.weeklyEth ? `${fmtEth(care.weeklyEth, 4)} at the Chainlink price` : 'in ETH at the Chainlink price'}
        />
        <LedgerRow
          label="Next payout"
          value={
            !wired || closed
              ? '7 days after launch'
              : owed > 0
                ? `${owed} ${owed === 1 ? 'week' : 'weeks'} due`
                : fmtCountdown(care?.nextPayoutAt ?? null, now)
          }
        />
        {wired && !full && !closed && care?.routing?.shortfallUsd != null && (
          <LedgerRow label="Still to fill" value={fmtUsd(care.routing.shortfallUsd, { decimals: 0 })} />
        )}
      </div>

      {wired && !closed && (
        <>
          <button onClick={pay} disabled={!care?.canPay || tx.busy} className={`${BTN} mt-4 w-full`}>
            {tx.busy
              ? 'Waiting…'
              : care?.canPay
                ? `Pay the keeper ${owed > 1 ? `${owed} weeks` : 'this week'}`
                : owed > 0
                  ? 'The vault holds less than one week'
                  : nextIn !== null && nextIn > 0
                    ? `Next payout in ${fmtCountdown(care?.nextPayoutAt ?? null, now)}`
                    : 'Pay the keeper'}
          </button>
          <p className="mt-2 font-voice text-[12.5px] leading-[1.55] text-muted">
            Anyone can press this once a week is due. The money only goes to the keeper&apos;s address. A week the vault
            can&apos;t cover stays owed and is paid when it can.
          </p>
          <TxNote state={tx.state} explorer={explorer} doneText="The keeper has been paid." />
        </>
      )}
      {!wired && <p className={`${LABEL} mt-4`}>Payouts start once the contracts are deployed.</p>}
    </Panel>
  )
}
