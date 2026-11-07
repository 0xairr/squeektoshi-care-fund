// GET /api/overview — hamster/wheel status and SqueekCore state.
const { Router } = require('express')
const squeek = require('../lib/squeek')
const { getSqueekCoreState, getSqueekCoreConfiguration } = require('../lib/chain')
const { jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (_req, res) => {
  const [status, onchainState, coreCfg] = await Promise.all([
    squeek.status().catch(() => null),
    getSqueekCoreState(),
    getSqueekCoreConfiguration(),
  ])

  // On-chain state() is authoritative; fall back to the API's view of the core.
  let core = onchainState
  if (!core) {
    const apiCore = await squeek.core().catch(() => null)
    if (apiCore?.core) {
      core = {
        settledThroughRound: Number(apiCore.core.settledThroughRound ?? 0),
        cumulativeWork: apiCore.core.cumulativeWork ?? null,
        blockHeight: Number(apiCore.core.blockHeight ?? 0),
        blockProgress: apiCore.core.blockProgress ?? null,
        workPerThousandBlocks: Number(apiCore.core.workPerThousandBlocks ?? 0),
        paused: null,
      }
    }
  }

  let round = null
  if (coreCfg?.genesisTimestamp && coreCfg?.roundDuration) {
    const now = Math.floor(Date.now() / 1000)
    const current = Math.floor((now - coreCfg.genesisTimestamp) / coreCfg.roundDuration) + 1
    round = { current, endsAt: coreCfg.genesisTimestamp + current * coreCfg.roundDuration }
  }

  res.json(
    jsonSafe({
      ok: Boolean(status || core),
      status: squeek.trimStatus(status),
      core,
      roundConfig: coreCfg,
      round,
      generatedAt: new Date().toISOString(),
    })
  )
})

module.exports = router
