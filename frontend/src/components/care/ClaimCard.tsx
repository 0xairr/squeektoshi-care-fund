import { BTN_PRIMARY, Panel, VOICE } from './Card'
import { TxNote } from './TxNote'
import { useAirdrop, useConfig } from '../../lib/hooks'
import { fmtTokens } from '../../lib/format'
import { buildClaimTx } from '../../lib/swap'
import { useAccount, useOpenConnect } from '../../lib/wallet'
import { useTx } from '../../lib/useTx'

/** The 7% Squeek Genesis airdrop: one claim per wallet from the snapshot. */
export function ClaimCard() {
  const { data: config } = useConfig()
  const { account } = useAccount()
  const openConnect = useOpenConnect()
  const { data: drop } = useAirdrop(account)
  const tx = useTx()

  const ticker = config?.ticker ?? 'CARE'
  const me = drop?.me ?? null
  const open = drop?.deadline ? Date.now() / 1000 < drop.deadline : true
  const closes = drop?.deadline
    ? new Date(drop.deadline * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null

  async function claim() {
    if (!drop?.airdrop || !me?.eligible || !me.account || !me.amountWei || !me.proof) return
    await tx.run([{ label: `Claim $${ticker}`, tx: buildClaimTx(drop.airdrop, me.account, BigInt(me.amountWei), me.proof) }])
  }

  return (
    <Panel id="airdrop" className="scroll-mt-28" title="Squeek holder airdrop" pop>
      <p className={VOICE}>
        7% of ${ticker} goes to Squeek Genesis holders. A merged Squeek counts for every Squeek inside it, and a staked
        one counts for the wallet that staked it.
      </p>

      <div className="mt-4 rounded-[18px] border-[2.5px] border-edge bg-card2 p-4 text-center">
        {!account ? (
          <p className="font-voice text-[15px] font-bold text-ink2">Connect the wallet that held your Squeeks.</p>
        ) : !me ? (
          <p className="font-voice text-[15px] font-bold text-ink2">Checking the snapshot…</p>
        ) : !me.eligible ? (
          <p className="font-voice text-[15px] font-bold text-ink2">This wallet held no Squeeks at the snapshot.</p>
        ) : (
          <>
            <div className="font-display text-[40px] leading-none text-ink">{fmtTokens(me.amountWei)}</div>
            <div className="mt-1 font-voice text-[14px] font-bold text-ink2">${ticker} for this wallet</div>
          </>
        )}
      </div>

      <button
        onClick={account ? claim : openConnect}
        disabled={Boolean(account) && (!me?.eligible || me.claimed || !open || tx.busy)}
        className={`${BTN_PRIMARY} mt-4 w-full`}
      >
        {!account
          ? 'Connect wallet'
          : tx.busy
            ? 'Waiting…'
            : me?.claimed
              ? 'Claimed'
              : !open
                ? 'Claims have closed'
                : me?.eligible
                  ? `Claim ${fmtTokens(me.amountWei)} $${ticker}`
                  : 'Nothing to claim'}
      </button>
      <TxNote state={tx.state} explorer={config?.explorer ?? 'https://sepolia.etherscan.io'} doneText="Claimed. It's in your wallet." />

      <p className="mt-3 font-voice text-[13px] font-semibold text-muted">
        {closes ? `Claims close on ${closes}. Anything unclaimed is burned.` : 'Anything unclaimed is burned when claims close.'}
      </p>
    </Panel>
  )
}
