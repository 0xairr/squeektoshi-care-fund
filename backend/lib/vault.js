// CareVault reads: one multicall for the live state, and the event history from the indexer.
const { parseAbi } = require('viem')
const { client, safe, latestBlock } = require('./chain')
const { config } = require('./config')
const { cached } = require('./cache')
const { vaultEvents } = require('./indexes')

const VAULT_ABI = parseAbi([
  'function preview() view returns (uint256 balance, uint256 balanceUsd, bool priceOk, uint256 ethUsdPrice, uint256 cap, uint256 weeklyUsd, uint256 weeklyEth, uint256 nextPayout, uint256 owedWeeks, bool closed)',
  'function careShortfallEth() view returns (uint256)',
  'function monthlyAllowanceUsd() view returns (uint256)',
  'function retiredAt() view returns (uint64)',
  'function lastPaidAt() view returns (uint64)',
])

function getVaultState() {
  const address = config.addresses.vault
  if (!address) return Promise.resolve(null)
  // Keyed to the chain head: one read per block, and fresh as soon as a transaction lands.
  return safe(async () => {
    const head = await latestBlock()
    return cached(`vault:state:${address}:${head}`, 60_000, async () => {
      const calls = ['preview', 'careShortfallEth', 'monthlyAllowanceUsd', 'retiredAt', 'lastPaidAt'].map(
        (functionName) => ({ address, abi: VAULT_ABI, functionName })
      )
      const [preview, shortfall, monthly, retiredAt, lastPaidAt] = await client.multicall({
        contracts: calls,
        allowFailure: false,
      })
      const [balance, balanceUsd, priceOk, , cap, weeklyUsd, weeklyEth, nextPayout, owedWeeks, closed] = preview
      const max = (1n << 256n) - 1n
      return {
        address,
        balanceWei: balance,
        priceOk,
        balanceUsd: priceOk ? Number(balanceUsd) / 1e8 : null,
        capUsd: Number(cap) / 1e8,
        monthlyUsd: Number(monthly) / 1e8,
        weeklyUsd: Number(weeklyUsd) / 1e8,
        weeklyEth: priceOk ? Number(weeklyEth) / 1e18 : null,
        nextPayoutAt: Number(nextPayout),
        weeksOwed: Number(owedWeeks),
        // the vault answers "everything" when it cannot price its cap
        shortfallEth: shortfall === max ? null : Number(shortfall) / 1e18,
        closed,
        retiredAt: Number(retiredAt) || null,
        lastPaidAt: Number(lastPaidAt),
        // pay() succeeds when a week is owed and the vault covers at least one
        canPay: !closed && priceOk && Number(owedWeeks) > 0 && weeklyEth > 0n && balance >= weeklyEth,
      }
    })
  })
}

/** Vault history, newest first. Fees arrive from the PoolManager; anything else is a donation. */
async function getVaultHistory() {
  if (!config.addresses.vault) return []
  const items = await vaultEvents.sync().catch(() => [])
  const poolManager = (config.addresses.poolManager || '').toLowerCase()
  return items
    .map((e) => {
      let kind = 'other'
      if (e.event === 'Payout') kind = 'payout'
      else if (e.event === 'Swept') kind = 'sweep'
      else if (e.event === 'Retired') kind = 'retire'
      else if (e.event === 'Deposited') kind = String(e.args.from).toLowerCase() === poolManager ? 'fee' : 'donation'
      return {
        kind,
        amountWei: e.args.amount ?? 0n,
        weeksPaid: e.args.weeksPaid !== undefined ? Number(e.args.weeksPaid) : null,
        from: e.args.from ?? null,
        blockNumber: e.blockNumber,
        logIndex: e.logIndex,
        txHash: e.txHash,
      }
    })
    .reverse()
}

module.exports = { getVaultState, getVaultHistory, VAULT_ABI }
