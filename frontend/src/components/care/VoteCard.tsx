import { useEffect, useState } from 'react'
import { BTN, BTN_PRIMARY, INPUT_SHELL, LABEL, Panel, VOICE } from './Card'
import { TxNote } from './TxNote'
import { useBallot, useConfig, useWallet } from '../../lib/hooks'
import { fmtCountdown, fmtTokens, fmtUsd } from '../../lib/format'
import { buildApproveTx, buildEnactTx, buildVoteTx, buildWithdrawTx, formatUnits18, parseUnits18 } from '../../lib/swap'
import { useAccount, useOpenConnect } from '../../lib/wallet'
import { useTx, type TxStep } from '../../lib/useTx'

const OPTIONS = [300, 400, 500, 600, 700, 800, 900, 1000]

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Holders vote each 30-day round on the monthly allowance by locking CARE until the round ends. */
export function VoteCard() {
  const { data: config } = useConfig()
  const { account } = useAccount()
  const openConnect = useOpenConnect()
  const { data: ballot } = useBallot(account)
  const { data: wallet } = useWallet(account)
  const tx = useTx()
  const now = useNow()
  const [pick, setPick] = useState<number | null>(null)
  const [amount, setAmount] = useState('')

  const ticker = config?.ticker ?? 'CARE'
  const token = config?.addresses?.token ?? null
  const address = ballot?.ballot ?? config?.addresses?.ballot ?? null
  const live = Boolean(ballot?.wired && address && token)
  const weights = (ballot?.weights ?? []).map((w) => BigInt(w))
  const total = weights.reduce((a, b) => a + b, 0n)
  const mine = ballot?.me ?? null
  const myOption = mine?.option ?? null
  const chosen = pick ?? myOption
  const amountWei = parseUnits18(amount) ?? 0n
  const balance = wallet?.tokenWei ? BigInt(wallet.tokenWei) : 0n
  const lockedNow = mine?.lockedNowWei ? BigInt(mine.lockedNowWei) : 0n
  const tooMuch = amountWei > balance
  const canVote = live && chosen !== null && (amountWei > 0n || lockedNow > 0n) && !tooMuch

  async function vote() {
    if (!address || !token || chosen === null) return
    if (!account) return openConnect()
    const steps: TxStep[] = []
    const allowance = mine?.allowanceWei ? BigInt(mine.allowanceWei) : 0n
    if (amountWei > 0n && allowance < amountWei) steps.push({ label: `Allow the ballot to lock $${ticker}`, tx: buildApproveTx(token, address) })
    steps.push({ label: `Vote ${fmtUsd(OPTIONS[chosen], { decimals: 0 })}`, tx: buildVoteTx(address, chosen, amountWei) })
    if (await tx.run(steps)) {
      setAmount('')
      setPick(null)
    }
  }

  const previous = ballot?.previous ?? null

  return (
    <Panel id="vote" className="scroll-mt-28" title="Vote on his allowance" pop>
      <p className={VOICE}>
        Every 30 days holders pick Squeektoshi&apos;s monthly allowance. Each ${ticker} you lock is one vote, and you get it
        back when the round ends.
      </p>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[26px] leading-none text-ink">
          Now {fmtUsd(ballot?.monthlyAllowanceUsd ?? 1000, { decimals: 0 })}/month
        </span>
        {ballot?.endsAt ? (
          <span className={LABEL}>
            Round {ballot.round! + 1} ends in {fmtCountdown(ballot.endsAt, now)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Monthly allowance">
        {OPTIONS.map((usd, i) => {
          const share = total > 0n ? Number((weights[i] * 1000n) / total) / 10 : 0
          const selected = chosen === i
          return (
            <button
              key={usd}
              role="radio"
              aria-checked={selected}
              onClick={() => setPick(i)}
              className={`relative overflow-hidden rounded-[14px] border-[2.5px] px-2 py-2.5 text-center transition-colors ${
                selected ? 'border-edge bg-sun' : 'border-rule bg-card hover:border-edge'
              }`}
            >
              <span
                className="absolute inset-x-0 bottom-0 bg-wheel/15"
                style={{ height: `${share}%` }}
                aria-hidden="true"
              />
              <span className="relative block font-display text-[18px] leading-none text-ink">${usd.toLocaleString('en-US')}</span>
              {(myOption === i || total > 0n) && (
                <span className="relative mt-1 block font-voice text-[12px] font-bold text-muted">
                  {myOption === i ? 'Your vote' : `${share.toFixed(0)}%`}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-2 font-voice text-[13px] font-semibold text-muted">
        {total > 0n
          ? `Leading: ${fmtUsd(ballot?.leading?.monthlyUsd ?? 0, { decimals: 0 })}, with ${fmtTokens(total)} $${ticker} locked.`
          : 'No votes yet. If nobody votes, it stays the same.'}
      </p>

      <div className="mt-4 flex items-center justify-between">
        <span className={LABEL}>{lockedNow > 0n ? `Add more (you have ${fmtTokens(lockedNow)} locked)` : `$${ticker} to lock`}</span>
        {account && (
          <button onClick={() => setAmount(formatUnits18(balance, 2))} className="font-voice text-[13px] font-bold text-muted hover:text-hover">
            Max {fmtTokens(balance)}
          </button>
        )}
      </div>
      <div className={`${INPUT_SHELL} mt-2`}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          aria-label={`${ticker} to lock`}
          placeholder={lockedNow > 0n ? '0 to just change your vote' : '0'}
          className="w-full bg-transparent font-display text-[26px] tabular-nums text-ink outline-none placeholder:text-muted"
        />
        <span className="font-voice text-[13px] font-bold text-muted">${ticker}</span>
      </div>

      <button onClick={account ? vote : openConnect} disabled={account ? !canVote || tx.busy : false} className={`${BTN_PRIMARY} mt-4 w-full`}>
        {!live
          ? 'Not live yet'
          : !account
            ? 'Connect wallet'
            : tx.busy
              ? 'Waiting…'
              : chosen === null
                ? 'Pick an amount'
                : tooMuch
                  ? `Not enough $${ticker}`
                  : `Vote ${fmtUsd(OPTIONS[chosen], { decimals: 0 })} a month`}
      </button>
      <TxNote state={tx.state} explorer={config?.explorer ?? 'https://sepolia.etherscan.io'} doneText="Vote counted." />

      {(mine?.withdrawable?.length ?? 0) > 0 && (
        <div className="mt-4 space-y-2">
          {mine!.withdrawable.map((w) => (
            <button
              key={w.round}
              onClick={() => address && tx.run([{ label: 'Take back your CARE', tx: buildWithdrawTx(address, w.round) }])}
              disabled={tx.busy}
              className={`${BTN} w-full`}
            >
              Take back {fmtTokens(w.amountWei)} ${ticker} from round {w.round + 1}
            </button>
          ))}
        </div>
      )}

      {previous?.canEnact && BigInt(previous.totalLocked) > 0n && (
        <button
          onClick={() => address && tx.run([{ label: 'Apply the last vote', tx: buildEnactTx(address, previous.round) }])}
          disabled={tx.busy}
          className={`${BTN} mt-3 w-full`}
        >
          Apply round {previous.round + 1}: {fmtUsd(previous.monthlyUsd, { decimals: 0 })}/month
        </button>
      )}
    </Panel>
  )
}
