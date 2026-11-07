// GET /api/care — the vault, where the fee is going, the burn, and fee totals.
// Before the contracts are deployed this returns the plan from the config (wired: false).
const { Router } = require('express')
const { config } = require('../lib/config')
const { getEthUsd } = require('../lib/chain')
const { getVaultState, getVaultHistory } = require('../lib/vault')
const { getBurnStats } = require('../lib/burn')
const { getFeeTotals } = require('../lib/v4')
const { jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (_req, res) => {
  const { economics } = config
  const [price, vault, history, burn, totals] = await Promise.all([
    getEthUsd(),
    getVaultState(),
    getVaultHistory().catch(() => []),
    getBurnStats(),
    config.wired.pool ? getFeeTotals() : Promise.resolve(null),
  ])

  // The vault publishes its own limits; the config is only the pre-launch fallback.
  const monthlyUsd = vault?.monthlyUsd ?? economics.monthlyAllowanceUsd
  const targetUsd = vault?.capUsd ?? monthlyUsd
  const weeklyUsd = vault?.weeklyUsd ?? (monthlyUsd * 12) / 52
  const balanceEth = vault ? Number(vault.balanceWei) / 1e18 : null
  const balanceUsd = vault?.balanceUsd ?? null
  const progressPct = balanceUsd === null ? null : Math.min(100, (balanceUsd / targetUsd) * 100)

  // Where the next fee goes: the vault while it is short of a month, the burn once it is full or
  // closed. With an unreadable price the vault keeps the fee (shortfall unknown = care needs it).
  const shortfallEth = vault ? vault.shortfallEth : null
  const mode = vault && (vault.closed || shortfallEth === 0) ? 'burn' : 'care'
  const lastPayout = history.find((e) => e.kind === 'payout') || null

  res.json(
    jsonSafe({
      ok: true,
      wired: config.wired.vault,
      ethUsd: price ? { usd: price.usd, updatedAt: price.updatedAt, stale: price.stale } : null,
      feeBps: economics.feeBps,
      balanceEth,
      balanceUsd,
      targetUsd,
      monthlyAllowanceUsd: monthlyUsd,
      weeklyUsd,
      weeklyEth: vault?.weeklyEth ?? (price ? weeklyUsd / price.usd : null),
      payoutIntervalSeconds: economics.payoutIntervalSeconds,
      progressPct,
      funded: vault ? shortfallEth === 0 : null,
      routing: {
        mode,
        shortfallEth,
        shortfallUsd: shortfallEth !== null && price ? shortfallEth * price.usd : null,
      },
      nextPayoutAt: vault?.nextPayoutAt ? new Date(vault.nextPayoutAt * 1000).toISOString() : null,
      weeksOwed: vault?.weeksOwed ?? 0,
      canPay: vault?.canPay ?? false,
      closed: vault?.closed ?? false,
      retiredAt: vault?.retiredAt ?? null,
      lastPayout: lastPayout
        ? {
            amountEth: Number(lastPayout.amountWei) / 1e18,
            weeksPaid: lastPayout.weeksPaid,
            txHash: lastPayout.txHash,
            blockNumber: lastPayout.blockNumber,
          }
        : null,
      burn,
      totals,
      keeper: config.addresses.keeper,
      rescue: config.addresses.rescue,
      vaultAddress: config.addresses.vault,
      generatedAt: new Date().toISOString(),
    })
  )
})

module.exports = router
