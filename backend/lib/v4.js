// Uniswap v4 reads for the pool: quotes from the V4Quoter, the trade feed, and a wallet's balances
// and approvals for the sell flow.
const { parseAbi, encodeFunctionData, decodeAbiParameters, isAddress, getAddress } = require('viem')
const { client } = require('./chain')
const { config } = require('./config')
const { cached, visitorCached, bigAbs } = require('./cache')
const { swapEvents, feeEvents, getPoolKey, getPoolId, POOL_KEY_ABI } = require('./indexes')
const { resolveBurner } = require('./burn')

const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'poolKey', ...POOL_KEY_ABI },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
]

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])

const PERMIT2_ABI = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
])

/**
 * What an exact-input swap pays out, simulated by the V4Quoter through the hook, so the 5% fee is
 * already in the number. side 'buy' = ETH in, 'sell' = tokens in.
 */
async function quote(side, amountInWei) {
  const key = getPoolKey()
  const quoter = config.addresses.quoter
  if (!key || !quoter) return null
  const zeroForOne = side === 'buy'
  // The amount comes from the visitor, so this lives in the visitor cache.
  return visitorCached(`quote:${side}:${amountInWei}`, 5000, async () => {
    const data = encodeFunctionData({
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey: key, zeroForOne, exactAmount: amountInWei, hookData: '0x' }],
    })
    const result = await client.call({ to: quoter, data })
    const [amountOut, gasEstimate] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], result.data)
    return { amountOut, gasEstimate, impactBps: await priceImpactBps(side, amountInWei, amountOut) }
  })
}

/**
 * How much worse than the pool's current price this swap fills, in basis points, with the 5% fee
 * taken out first so the two are never confused. Null when the pool price cannot be read.
 */
async function priceImpactBps(side, amountIn, amountOut) {
  const stateView = config.addresses.stateView
  const poolId = getPoolId()
  if (!stateView || !poolId) return null
  try {
    const [sqrtPriceX96] = await client.readContract({
      address: stateView,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [poolId],
    })
    if (sqrtPriceX96 === 0n) return null
    const Q192 = 1n << 192n
    const priceX192 = sqrtPriceX96 * sqrtPriceX96 // CARE per ETH, scaled by 2^192
    const afterFee = (amountIn * BigInt(10_000 - config.economics.feeBps)) / 10_000n
    // buy: fee comes off the ETH in; sell: fee comes off the ETH out, so it is applied after.
    let ideal
    if (side === 'buy') ideal = (afterFee * priceX192) / Q192
    else ideal = (((amountIn * Q192) / priceX192) * BigInt(10_000 - config.economics.feeBps)) / 10_000n
    if (ideal <= 0n) return null
    if (amountOut >= ideal) return 0
    return Number(((ideal - amountOut) * 10_000n) / ideal)
  } catch {
    return null
  }
}

/**
 * Recent trades on the pool, oldest first. The Swap event shows the ETH that reached the pool; the
 * hook's FeeTaken in the same transaction adds the fee back, so a buy shows what the buyer paid and
 * a sell what the seller received.
 */
async function getTrades(sinceBlock) {
  const key = getPoolKey()
  if (!key || !config.addresses.poolManager) return { wired: false, trades: [], latestBlock: null, count: 0 }

  const [swaps, fees, burner] = await Promise.all([
    swapEvents.sync(),
    feeEvents.sync().catch(() => []),
    resolveBurner().catch(() => null),
  ])
  const burnerLc = burner ? burner.toLowerCase() : null
  const feeByTx = new Map()
  for (const f of fees) {
    const list = feeByTx.get(f.txHash) || []
    list.push(f)
    feeByTx.set(f.txHash, list)
  }

  const recent = swaps.filter((s) => (sinceBlock ? s.blockNumber > sinceBlock : true)).slice(-25)
  const trades = []
  for (const s of recent) {
    // v4 reports amounts from the swapper's side: negative is what the swapper paid in.
    const { amount0, amount1, sender } = s.args
    const isBuy = amount0 < 0n
    // The burner's own buyback is a burn, not a trade: it pays no fee and nobody receives tokens.
    const isBurn = burnerLc !== null && String(sender).toLowerCase() === burnerLc
    const fee = (feeByTx.get(s.txHash) || []).find((f) => f.args.buy === isBuy)
    let feeWei = 0n
    if (fee) feeWei = fee.args.fee
    const poolEth = bigAbs(amount0)
    let ethWei = 0n
    if (isBuy) ethWei = poolEth + feeWei
    else if (poolEth > feeWei) ethWei = poolEth - feeWei
    let trader = null
    try {
      const tx = await cached(`tx:${s.txHash}`, 3_600_000, () => client.getTransaction({ hash: s.txHash }))
      trader = tx?.from ?? null
    } catch {
      trader = null
    }
    trades.push({
      txHash: s.txHash,
      blockNumber: s.blockNumber,
      side: isBurn ? 'burn' : isBuy ? 'buy' : 'sell',
      ethWei,
      feeWei,
      tokenWei: bigAbs(amount1),
      trader,
    })
  }
  const head = swaps.length ? swaps[swaps.length - 1].blockNumber : null
  const count = swaps.filter((s) => !burnerLc || String(s.args.sender).toLowerCase() !== burnerLc).length
  return { wired: true, trades, latestBlock: head, count }
}

/** Fee totals since launch, from the hook's own events. */
async function getFeeTotals() {
  const fees = await feeEvents.sync().catch(() => null)
  if (!fees) return null
  let fee = 0n
  let toCare = 0n
  let toBurn = 0n
  for (const f of fees) {
    fee += f.args.fee
    toCare += f.args.toCare
    toBurn += f.args.toBurn
  }
  return { swaps: fees.length, feeEth: Number(fee) / 1e18, toCareEth: Number(toCare) / 1e18, toBurnEth: Number(toBurn) / 1e18 }
}

/** Balances and approvals a wallet needs for the buy and sell buttons. */
async function getWallet(address) {
  if (!isAddress(address)) return null
  const owner = getAddress(address)
  const { token, permit2, universalRouter } = config.addresses
  return visitorCached(`wallet:${owner}`, 3000, async () => {
    const eth = await client.getBalance({ address: owner })
    if (!token || !permit2 || !universalRouter) return { address: owner, ethWei: eth, tokenWei: null }
    const [tokenWei, toPermit2, p2] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] },
        { address: token, abi: ERC20_ABI, functionName: 'allowance', args: [owner, permit2] },
        { address: permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, token, universalRouter] },
      ],
    })
    return {
      address: owner,
      ethWei: eth,
      tokenWei,
      tokenAllowanceToPermit2Wei: toPermit2,
      permit2: { amountWei: p2[0], expiration: Number(p2[1]) },
    }
  })
}

module.exports = { quote, getTrades, getFeeTotals, getWallet }
