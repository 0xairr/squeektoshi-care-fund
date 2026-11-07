// GET /api/config — public site config: names, addresses, the pool key.
const { Router } = require('express')
const { config } = require('../lib/config')
const { getPoolKey, getPoolId } = require('../lib/indexes')

const router = Router()

router.get('/', (_req, res) => {
  const a = config.addresses
  const key = getPoolKey()
  res.json({
    name: config.name,
    ticker: config.ticker,
    network: config.network,
    explorer: config.explorer,
    economics: config.economics,
    burn: config.burn,
    wired: config.wired,
    addresses: {
      token: a.token,
      vault: a.vault,
      hook: a.hook,
      keeper: a.keeper,
      rescue: a.rescue,
      poolManager: a.poolManager,
      router: a.universalRouter,
      quoter: a.quoter,
      permit2: a.permit2,
      squeekCore: a.squeekCore,
      ballot: a.ballot,
      airdrop: a.airdrop,
    },
    pool: key ? { ...key, poolId: getPoolId() } : null,
    links: { squeekchain: config.squeekchainSite, docs: config.squeekchainDocs },
  })
})

module.exports = router
