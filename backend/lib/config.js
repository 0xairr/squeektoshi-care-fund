// Loads the deployment config. After deploying, fill in backend/config/care.json; the file is re-read
// automatically (no restart), so the site switches to live numbers on save.
const path = require('node:path')
const fs = require('node:fs')
const { isAddress, getAddress } = require('viem')

// CARE_CONFIG points at another file (a local test deployment, say) without touching this one.
const file = process.env.CARE_CONFIG ? path.resolve(process.env.CARE_CONFIG) : path.join(__dirname, '..', 'config', 'care.json')

// A typo in an address should leave that part of the site "not deployed", not crash it.
function addr(value) {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null
}

function build(raw) {
  const a = raw.addresses || {}
  const pool = raw.pool || {}
  const economics = raw.economics || {}
  const burn = raw.burn || {}

  const config = {
    name: raw.name || 'Squeektoshi Care Fund',
    ticker: raw.ticker || 'CARE',
    network: raw.network || { name: 'Sepolia', chainId: 11155111 },
    squeekchainApi: raw.squeekchainApi || 'https://api.squeekchain.com',
    squeekchainSite: raw.squeekchainSite || 'https://squeekchain.com',
    squeekchainDocs: raw.squeekchainDocs || 'https://docs.squeekchain.com',
    explorer: raw.explorer || 'https://sepolia.etherscan.io',
    addresses: {
      token: addr(a.token),
      vault: addr(a.vault),
      hook: addr(a.hook),
      keeper: addr(a.keeper),
      rescue: addr(a.rescue),
      poolManager: addr(a.poolManager),
      universalRouter: addr(a.universalRouter),
      quoter: addr(a.quoter),
      stateView: addr(a.stateView),
      ballot: addr(a.ballot),
      airdrop: addr(a.airdrop),
      permit2: addr(a.permit2),
      chainlinkEthUsd: addr(a.chainlinkEthUsd),
      squeekCore: addr(a.squeekCore),
    },
    pool: {
      fee: Number.isInteger(pool.fee) ? pool.fee : 0,
      tickSpacing: Number.isInteger(pool.tickSpacing) ? pool.tickSpacing : 60,
    },
    // The block the contracts were deployed at: history is read from here on.
    deployBlock: Number.isInteger(raw.deployBlock) ? raw.deployBlock : null,
    economics: {
      feeBps: economics.feeBps ?? 500,
      monthlyAllowanceUsd: economics.monthlyAllowanceUsd ?? 1000,
      payoutIntervalSeconds: economics.payoutIntervalSeconds ?? 604800,
    },
    burn: {
      burnAddress: addr(burn.burnAddress) || '0x000000000000000000000000000000000000dEaD',
      minEthToBurn: burn.minEthToBurn ?? 0.005,
      maxSlippageBps: burn.maxSlippageBps ?? 300,
    },
  }

  config.wired = {
    vault: Boolean(config.addresses.vault),
    pool: Boolean(config.addresses.token && config.addresses.hook && config.addresses.poolManager),
  }
  return config
}

let data = build(JSON.parse(fs.readFileSync(file, 'utf8')))
let mtimeMs = 0
let checkedAt = 0

function current() {
  const now = Date.now()
  if (now - checkedAt > 1000) {
    checkedAt = now
    try {
      const st = fs.statSync(file)
      if (st.mtimeMs !== mtimeMs) {
        mtimeMs = st.mtimeMs
        data = build(JSON.parse(fs.readFileSync(file, 'utf8')))
      }
    } catch {
      // keep the last good config if the file is mid-write or invalid
    }
  }
  return data
}

// Reads go through the live snapshot, so callers never hold a stale copy.
const config = new Proxy(
  {},
  {
    get: (_target, prop) => current()[prop],
    has: (_target, prop) => prop in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, prop) => ({ configurable: true, enumerable: true, get: () => current()[prop] }),
  }
)

module.exports = { config }
