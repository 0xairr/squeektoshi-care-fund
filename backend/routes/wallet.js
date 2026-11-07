// GET /api/wallet?address=0x… — balances and approvals for the buy and sell buttons.
const { Router } = require('express')
const { getWallet } = require('../lib/v4')
const { jsonSafe } = require('../lib/cache')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const wallet = await getWallet(String(req.query.address ?? ''))
    if (!wallet) return res.status(400).json({ ok: false, error: 'invalid_address' })
    res.json(jsonSafe({ ok: true, ...wallet }))
  } catch {
    res.json({ ok: false, error: 'unavailable' })
  }
})

module.exports = router
