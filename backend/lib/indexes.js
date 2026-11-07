// The event histories the site shows, each read incrementally from the deploy block.
const { parseAbi, parseAbiItem, encodeAbiParameters, keccak256 } = require('viem')
const { config } = require('./config')
const { createIndexer } = require('./indexer')

const VAULT_EVENTS = parseAbi([
  'event Deposited(address indexed from, uint256 amount, uint256 balance)',
  'event Payout(address indexed keeper, uint256 amount, uint256 weeksPaid, uint256 ethUsdPrice)',
  'event Retired(uint256 at)',
  'event Swept(address indexed rescue, uint256 amount)',
])
const HOOK_EVENTS = parseAbi(['event FeeTaken(bool indexed buy, uint256 fee, uint256 toCare, uint256 toBurn)'])
const BURNER_EVENTS = parseAbi(['event Burned(uint256 ethIn, uint256 tokensBurned, address indexed caller)'])
const SWAP_EVENT = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'
)

const NATIVE = '0x0000000000000000000000000000000000000000'
const POOL_KEY_ABI = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
}

function getPoolKey() {
  const { token, hook } = config.addresses
  if (!token || !hook) return null
  return { currency0: NATIVE, currency1: token, fee: config.pool.fee, tickSpacing: config.pool.tickSpacing, hooks: hook }
}

function getPoolId() {
  const key = getPoolKey()
  if (!key) return null
  return keccak256(
    encodeAbiParameters([POOL_KEY_ABI], [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]])
  )
}

const fromDeploy = () => config.deployBlock

const vaultEvents = createIndexer({ address: () => config.addresses.vault, abi: VAULT_EVENTS, fromBlock: fromDeploy })
const feeEvents = createIndexer({ address: () => config.addresses.hook, abi: HOOK_EVENTS, fromBlock: fromDeploy })
const swapEvents = createIndexer({
  address: () => (getPoolId() ? config.addresses.poolManager : null),
  abi: [SWAP_EVENT],
  topics: () => [getPoolId()],
  fromBlock: fromDeploy,
})

// The burner's address is read from the hook (it deploys it), so it is resolved lazily.
let burnerAddress = { hook: null, value: null }
function setBurner(hook, value) {
  burnerAddress = { hook, value }
}
const burnEvents = createIndexer({
  address: () => (burnerAddress.hook === config.addresses.hook ? burnerAddress.value : null),
  abi: BURNER_EVENTS,
  fromBlock: fromDeploy,
})

module.exports = {
  vaultEvents,
  feeEvents,
  swapEvents,
  burnEvents,
  setBurner,
  getPoolKey,
  getPoolId,
  NATIVE,
  POOL_KEY_ABI,
}
