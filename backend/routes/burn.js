// GET /api/burn — a burn size that goes through right now, for the "burn now" button.
const { Router } = require('express')
const { getBurnPlan } = require('../lib/burn')
const { jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (_req, res) => {
  const plan = await getBurnPlan()
  res.json(jsonSafe({ ok: Boolean(plan), ...(plan || { ready: false, reason: 'unavailable' }) }))
})

module.exports = router
