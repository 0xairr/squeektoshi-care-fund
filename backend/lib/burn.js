// Buyback & burn reads: tokens destroyed so far, ETH waiting to be spent, burn history, and a burn
// size that will actually go through right now.
const { parseAbi } = require('viem')
const { client, safe, latestBlock } = require('./chain')
const { config } = require('./config')
const { cached } = require('./cache')
const { burnEvents, setBurner } = require('./indexes')

const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])
const HOOK_ABI = parseAbi(['function burner() view returns (address)'])
const BURNER_ABI = parseAbi([
  'function minEthToBurn() view returns (uint256)',
  'function maxSlippageBps() view returns (uint256)',
  'function slippageFloor(uint256 ethIn) view returns (uint256)',
  'function burn(uint256 ethIn, uint256 minTokensOut) returns (uint256)',
])

/** The burner is deployed by the hook, so its address is read from the hook. It never changes. */
async function resolveBurner() {
  const hook = config.addresses.hook
  if (!hook) return null
  const address = await cached(`burner:${hook}`, 3_600_000, () =>
    client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'burner' })
  )
  setBurner(hook, address)
  return address
}

function getBurnStats() {
  return safe(async () => {
    const head = await latestBlock()
    return cached(`burn:stats:${head}`, 60_000, async () => {
      const burner = await resolveBurner().catch(() => null)
      const token = config.addresses.token
      if (!burner || !token) return { wired: false, burner: null, burnAddress: config.burn.burnAddress }

      const [burned, pendingWei, minEth, maxSlip] = await Promise.all([
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [config.burn.burnAddress] }),
        client.getBalance({ address: burner }),
        client.readContract({ address: burner, abi: BURNER_ABI, functionName: 'minEthToBurn' }),
        client.readContract({ address: burner, abi: BURNER_ABI, functionName: 'maxSlippageBps' }),
      ])
      const history = await burnEvents.sync().catch(() => [])
      const burns = history.map((e) => ({
        ethIn: Number(e.args.ethIn) / 1e18,
        tokensBurned: Number(e.args.tokensBurned) / 1e18,
        caller: e.args.caller,
        blockNumber: e.blockNumber,
        txHash: e.txHash,
      }))
      return {
        wired: true,
        burner,
        burnAddress: config.burn.burnAddress,
        burnedTokens: Number(burned) / 1e18,
        pendingEth: Number(pendingWei) / 1e18,
        pendingWei: pendingWei.toString(),
        minEthToBurn: Number(minEth) / 1e18,
        maxSlippageBps: Number(maxSlip),
        burnCount: burns.length,
        burnedEth: burns.reduce((s, b) => s + b.ethIn, 0),
        recent: burns.slice(-10).reverse(),
      }
    })
  })
}

/**
 * The largest burn that goes through right now. A big burn can move the price further than the
 * burner's own slippage ceiling allows, so try everything that is waiting, then halve until the
 * simulation passes or the amount drops under the minimum.
 */
function getBurnPlan() {
  return safe(async () => {
    const head = await latestBlock()
    return cached(`burn:plan:${head}`, 60_000, async () => {
      const burner = await resolveBurner()
      if (!burner) return { ready: false, reason: 'not_deployed' }
      const [balance, minEth] = await Promise.all([
        client.getBalance({ address: burner }),
        client.readContract({ address: burner, abi: BURNER_ABI, functionName: 'minEthToBurn' }),
      ])
      if (balance < minEth) {
        return { ready: false, reason: 'below_minimum', pendingWei: balance.toString(), minWei: minEth.toString() }
      }
      for (let ethIn = balance; ethIn >= minEth; ethIn /= 2n) {
        const floor = await client.readContract({
          address: burner,
          abi: BURNER_ABI,
          functionName: 'slippageFloor',
          args: [ethIn],
        })
        const ok = await client
          .simulateContract({ address: burner, abi: BURNER_ABI, functionName: 'burn', args: [ethIn, floor] })
          .then(() => true)
          .catch(() => false)
        if (ok) {
          return { ready: true, burner, ethInWei: ethIn.toString(), minTokensOutWei: floor.toString(), pendingWei: balance.toString() }
        }
      }
      return { ready: false, reason: 'pool_too_thin', pendingWei: balance.toString(), minWei: minEth.toString() }
    })
  })
}

module.exports = { getBurnStats, getBurnPlan, resolveBurner }
