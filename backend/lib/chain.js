// Sepolia reads: SqueekCore (Squeekchain's on-chain core) and Chainlink ETH/USD.
// Every read is wrapped so a flaky RPC degrades to null instead of crashing a page.
const { createPublicClient, http, fallback, parseAbi } = require('viem')
const { sepolia } = require('viem/chains')
const { config } = require('./config')
const { cached } = require('./cache')

const PUBLIC_RPCS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.gateway.tenderly.co',
  'https://rpc.sepolia.ethpandaops.io',
]
// RPC_URLS (comma separated) replaces the list entirely; SEPOLIA_RPC_URL is tried before the public ones.
const rpcs = process.env.RPC_URLS
  ? process.env.RPC_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : [process.env.SEPOLIA_RPC_URL, ...PUBLIC_RPCS].filter(Boolean)

const client = createPublicClient({
  chain: sepolia,
  batch: { multicall: true },
  transport: fallback(
    rpcs.map((url) => http(url, { timeout: 12_000, retryCount: 0 })),
    { retryCount: 1 }
  ),
})

/** The chain head, shared by every caller for a few seconds. */
const latestBlock = () => cached('chain:head', 4000, () => client.getBlockNumber())

// Fragments of the published SqueekCore ABI (docs.squeekchain.com).
const SQUEEK_CORE_ABI = parseAbi([
  'function configuration() view returns ((bytes32 streamId, uint64 genesisTimestamp, uint64 roundDuration, uint64 maxWorkPerRound, uint16 maxRoundsPerBatch, address guardian, address reporter, uint32 initialWorkPerThousandBlocks, uint64 targetBlocksPerActiveRound, uint64 difficultySmoothingRounds, uint96 blockUnitsPerBlock))',
  'function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))',
])

const CHAINLINK_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
])

async function safe(fn) {
  try {
    return await fn()
  } catch {
    return null
  }
}

function getSqueekCoreState() {
  const address = config.addresses.squeekCore
  if (!address) return Promise.resolve(null)
  return safe(() =>
    cached('core:state', 5000, async () => {
      const s = await client.readContract({ address, abi: SQUEEK_CORE_ABI, functionName: 'state' })
      return {
        settledThroughRound: Number(s.settledThroughRound),
        cumulativeWork: s.cumulativeWork,
        blockHeight: Number(s.blockHeight),
        blockProgress: s.blockProgress,
        workPerThousandBlocks: Number(s.workPerThousandBlocks),
        paused: s.paused,
      }
    })
  )
}

function getSqueekCoreConfiguration() {
  const address = config.addresses.squeekCore
  if (!address) return Promise.resolve(null)
  return safe(() =>
    cached('core:config', 600_000, async () => {
      const c = await client.readContract({ address, abi: SQUEEK_CORE_ABI, functionName: 'configuration' })
      return {
        genesisTimestamp: Number(c.genesisTimestamp),
        roundDuration: Number(c.roundDuration),
        maxWorkPerRound: Number(c.maxWorkPerRound),
      }
    })
  )
}

/** Chainlink ETH/USD, 8 decimals. Older than 2h counts as stale (the vault's own rule). */
function getEthUsd() {
  const address = config.addresses.chainlinkEthUsd
  if (!address) return Promise.resolve(null)
  return safe(() =>
    cached('chainlink:ethusd', 30_000, async () => {
      const [, answer, , updatedAt] = await client.readContract({
        address,
        abi: CHAINLINK_ABI,
        functionName: 'latestRoundData',
      })
      const updatedSeconds = Number(updatedAt)
      const ageSeconds = Math.floor(Date.now() / 1000) - updatedSeconds
      return { usd: Number(answer) / 1e8, updatedAt: updatedSeconds, ageSeconds, stale: ageSeconds > 7200 }
    })
  )
}

module.exports = { client, latestBlock, safe, SQUEEK_CORE_ABI, getSqueekCoreState, getSqueekCoreConfiguration, getEthUsd }
