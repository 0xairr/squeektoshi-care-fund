// GET /api/payouts — vault history: payouts, donations, the end clause, and swap-fee totals.
const { Router } = require('express')
const { config } = require('../lib/config')
const { getVaultHistory } = require('../lib/vault')
const { getEthUsd, client } = require('../lib/chain')
const { cached, jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (_req, res) => {
  const [events, price] = await Promise.all([getVaultHistory().catch(() => []), getEthUsd()])

  const totals = { payoutsEth: 0, donationsEth: 0, feesEth: 0, feeCount: 0 }
  for (const e of events) {
    const eth = Number(e.amountWei) / 1e18
    if (e.kind === 'payout') totals.payoutsEth += eth
    if (e.kind === 'donation') totals.donationsEth += eth
    if (e.kind === 'fee') {
      totals.feesEth += eth
      totals.feeCount += 1
    }
  }

  // Swap fees arrive on every trade, so they are summed; everything else is listed one by one.
  const rows = events.filter((e) => e.kind !== 'fee').slice(0, 50)
  for (const row of rows) {
    const block = await cached(`block:${row.blockNumber}`, 86_400_000, () =>
      client.getBlock({ blockNumber: BigInt(row.blockNumber) })
    ).catch(() => null)
    row.timestamp = block ? Number(block.timestamp) : null
  }

  res.json(
    jsonSafe({
      ok: true,
      wired: config.wired.vault,
      events: rows.map((e) => {
        const amountEth = Number(e.amountWei) / 1e18
        return {
          kind: e.kind,
          amountEth,
          amountUsdToday: price ? amountEth * price.usd : null,
          weeksPaid: e.weeksPaid,
          from: e.from,
          timestamp: e.timestamp,
          txHash: e.txHash,
          blockNumber: e.blockNumber,
        }
      }),
      totals,
    })
  )
})

module.exports = router
