import { useCare, usePayouts } from '../../lib/hooks'
import { fmtEth, fmtTokenAmount, fmtUsd } from '../../lib/format'
import { LABEL, VALUE } from './Card'

function Cell({ label, value, hint, gold = false }: { label: string; value: string; hint: string; gold?: boolean }) {
  return (
    <div className="bg-card px-4 py-5">
      <div className={LABEL}>{label}</div>
      <div className={`${VALUE} mt-2 text-[32px] ${gold ? 'text-wheel' : 'text-ink'}`}>{value}</div>
      <div className="mt-1.5 font-voice text-[12.5px] leading-[1.45] text-muted">{hint}</div>
    </div>
  )
}

/** Running totals the vault card does not show: where the fee goes, and what it has done so far. */
export function StatusStrip() {
  const { data: care } = useCare()
  const { data: payouts } = usePayouts()

  const price = care?.ethUsd?.usd ?? null
  const usd = (eth: number | null | undefined) => (eth != null && price ? fmtUsd(eth * price, { decimals: 0 }) : null)
  const route = care?.routing?.mode ?? 'care'
  const fees = care?.totals?.feeEth ?? 0
  const burned = care?.burn?.burnedTokens ?? 0
  const paid = payouts?.totals?.payoutsEth ?? 0
  const swaps = care?.totals?.swaps ?? 0

  return (
    <div className="grid grid-cols-2 gap-[2.5px] overflow-hidden rounded-[22px] border-[2.5px] border-edge bg-edge">
      <Cell
        label="Fee on every swap"
        value={`${(care?.feeBps ?? 500) / 100}%`}
        hint={care?.closed ? 'Fund closed: every fee burns' : route === 'burn' ? 'Vault full: fees burn $CARE' : 'Going to the vault now'}
        gold
      />
      <Cell
        label="Fees so far"
        value={fmtEth(fees, 3)}
        hint={swaps > 0 ? `${usd(fees) ?? ''} from ${swaps} ${swaps === 1 ? 'swap' : 'swaps'}`.trim() : 'No swaps yet'}
      />
      <Cell
        label="$CARE burned"
        value={burned >= 1 ? fmtTokenAmount(burned) : '0'}
        hint={burned >= 1 ? 'Gone for good, at 0x…dEaD' : 'Burning starts once the vault is full'}
      />
      <Cell
        label="Paid to the keeper"
        value={fmtEth(paid, 3)}
        hint={paid > 0 ? `${usd(paid) ?? ''} so far`.trim() : 'First payout 7 days after launch'}
      />
    </div>
  )
}
