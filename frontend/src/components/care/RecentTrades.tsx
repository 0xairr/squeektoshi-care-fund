import { Chip, EmptyState, Panel } from './Card'
import { useConfig, useTrades } from '../../lib/hooks'
import { fmtTokens, fmtWeiEth, shortAddr } from '../../lib/format'

export function RecentTrades() {
  const { data: config } = useConfig()
  const { data } = useTrades(null, 30_000)
  const trades = [...(data?.trades ?? [])].reverse().slice(0, 10)
  const explorer = config?.explorer ?? 'https://sepolia.etherscan.io'
  const ticker = config?.ticker ?? 'CARE'

  return (
    <Panel
      title="Recent trades"
      action={data?.wired && data.count > 0 ? <span className="font-data text-[11px] text-muted">{data.count} trades since launch</span> : undefined}
    >
      {trades.length === 0 ? (
        <EmptyState>{data?.wired ? 'No trades yet.' : 'Trades show up here once the pool opens.'}</EmptyState>
      ) : (
        <ul>
          {trades.map((t) => (
            <li key={t.txHash} className="flex items-center justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
              <span className="flex min-w-0 items-center gap-3">
                <Chip tone={t.side === 'buy' ? 'live' : t.side === 'burn' ? 'gold' : 'neutral'}>{t.side}</Chip>
                <span className="truncate font-data text-[12px] text-ink2">
                  {t.side === 'burn'
                    ? `${fmtTokens(t.tokenWei)} $${ticker} bought back and burned`
                    : `${fmtTokens(t.tokenWei)} $${ticker} for ${fmtWeiEth(t.ethWei, 4)}`}
                </span>
              </span>
              <a
                className="shrink-0 font-data text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-hover"
                href={`${explorer}/tx/${t.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(t.trader)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
