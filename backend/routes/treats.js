// GET /api/treats?since=<block> — trades on the pool, for the stream overlay and the trade list.
const { Router } = require('express')
const { getTrades } = require('../lib/v4')
const { jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (req, res) => {
  const since = Number.parseInt(String(req.query.since ?? ''), 10)
  try {
    const data = await getTrades(Number.isFinite(since) && since > 0 ? since : null)
    res.json(jsonSafe({ ok: true, ...data }))
  } catch {
    res.json({ ok: false, wired: false, trades: [], latestBlock: null, count: 0 })
  }
})

module.exports = router
