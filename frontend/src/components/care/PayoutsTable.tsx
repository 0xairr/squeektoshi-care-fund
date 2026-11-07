import { Chip, EmptyState, LABEL, Panel } from './Card'
import { useConfig, usePayouts } from '../../lib/hooks'
import { fmtDate, fmtEth, fmtUsd } from '../../lib/format'

const KIND: Record<string, { label: string; tone: 'warn' | 'live' | 'off' | 'neutral' | 'blue' }> = {
  payout: { label: 'paid keeper', tone: 'warn' },
  donation: { label: 'donation', tone: 'live' },
  sweep: { label: 'to rescue', tone: 'blue' },
  retire: { label: 'retired', tone: 'neutral' },
  other: { label: 'event', tone: 'neutral' },
}

export function PayoutsTable() {
  const { data: config } = useConfig()
  const { data } = usePayouts()
  const events = data?.events ?? []
  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'

  return (
    <Panel
      title="Vault history"
      action={
        data?.wired && (events.length > 0 || data.totals.feeCount > 0) ? (
          <span className="font-data text-[11px] tabular-nums text-muted">
            {fmtEth(data.totals.feesEth, 4)} from {data.totals.feeCount} swaps, {fmtEth(data.totals.donationsEth, 4)}{' '}
            donated, {fmtEth(data.totals.payoutsEth, 4)} paid out
          </span>
        ) : undefined
      }
    >
      {events.length === 0 ? (
        <EmptyState>
          {data?.wired
            ? 'No payouts or donations yet. The first payout can go out 7 days after launch.'
            : 'No payouts yet: the first one can go out 7 days after launch. Payouts, donations and the end of the fund show up here, read straight from the vault contract.'}
        </EmptyState>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[540px] border-collapse">
            <thead>
              <tr className="border-b border-edge text-left">
                <th className={`${LABEL} pb-2 font-normal`}>What</th>
                <th className={`${LABEL} pb-2 font-normal`}>Amount</th>
                <th className={`${LABEL} pb-2 font-normal`}>≈ USD today</th>
                <th className={`${LABEL} pb-2 font-normal`}>When</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const kind = KIND[e.kind] ?? KIND.other
                return (
                  <tr key={`${e.txHash}-${e.blockNumber}-${e.kind}`} className="border-b border-rule hover:bg-card">
                    <td className="py-2.5 pr-3">
                      <Chip tone={kind.tone}>{kind.label}</Chip>
                    </td>
                    <td className="py-2.5 pr-3 font-display text-[20px] tabular-nums text-ink">
                      {fmtEth(e.amountEth, 4)}
                    </td>
                    <td className="py-2.5 pr-3 font-data text-[12px] tabular-nums text-muted">
                      {e.amountUsdToday !== null ? fmtUsd(e.amountUsdToday) : '—'}
                    </td>
                    <td className="py-2.5 pr-3 font-data text-[12px] text-muted">{fmtDate(e.timestamp)}</td>
                    <td className="py-2.5 text-right">
                      <a
                        className="font-data text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-hover"
                        href={`${explorer}/tx/${e.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 font-data text-[11px] text-muted">
            ETH amounts are exact. USD uses today&apos;s Chainlink price.
          </p>
        </div>
      )}
    </Panel>
  )
}
