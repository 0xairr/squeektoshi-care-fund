// GET /api/quote?side=buy&amount=0.01   (ETH in)
// GET /api/quote?side=sell&amount=1000  (tokens in)
// What the swap pays out, from the v4 Quoter, with the 5% fee already applied.
const { Router } = require('express')
const { config } = require('../lib/config')
const { quote } = require('../lib/v4')
const { jsonSafe } = require('../lib/cache')

const router = Router()
const MAX_IN = 10n ** 36n

function parseUnits18(input) {
  const s = String(input ?? '').trim()
  if (!/^\d{1,30}(\.\d{0,18})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18))
}

router.get('/', async (req, res) => {
  const side = req.query.side === 'sell' ? 'sell' : 'buy'
  const amountInWei = parseUnits18(req.query.amount)
  if (amountInWei === null || amountInWei <= 0n || amountInWei > MAX_IN) {
    return res.status(400).json({ ok: false, error: 'invalid_amount' })
  }
  if (!config.wired.pool) return res.json({ ok: true, wired: false, side, amountInWei: amountInWei.toString() })

  try {
    const q = await quote(side, amountInWei)
    if (!q) return res.json({ ok: true, wired: false, side, amountInWei: amountInWei.toString() })
    res.json(
      jsonSafe({ ok: true, wired: true, side, amountInWei, amountOutWei: q.amountOut, gasEstimate: q.gasEstimate, impactBps: q.impactBps })
    )
  } catch {
    // The quoter reverts when the pool cannot fill the amount, e.g. a sell bigger than the ETH in it.
    res.json({ ok: false, wired: true, side, error: 'quote_unavailable', amountInWei: amountInWei.toString() })
  }
})

module.exports = router
