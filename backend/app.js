// The JSON API as an Express app. server.js runs it as a long-lived process; api/index.js hands it to
// Vercel as a function. Routes are listed explicitly so bundlers can see every file.
const express = require('express')
const { rateLimit } = require('./lib/ratelimit')

const ROUTES = {
  airdrop: require('./routes/airdrop'),
  ballot: require('./routes/ballot'),
  burn: require('./routes/burn'),
  care: require('./routes/care'),
  config: require('./routes/config'),
  overview: require('./routes/overview'),
  payouts: require('./routes/payouts'),
  quote: require('./routes/quote'),
  treats: require('./routes/treats'),
  wallet: require('./routes/wallet'),
}

const app = express()
app.disable('x-powered-by')
// Behind a reverse proxy (Vercel, Render, nginx) the client IP is in X-Forwarded-For. Only trust it
// when told to, so the rate limit cannot be dodged with a forged header.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

const api = express.Router()
api.use(rateLimit({ windowMs: 60_000, max: 300 }))
// Answers that are the same for every visitor may sit on the CDN for a few seconds, so a crowd costs one
// function call per endpoint rather than one per visitor. Anything about one wallet, and quotes, never do.
const SHARED = new Set(['/airdrop', '/ballot', '/burn', '/care', '/config', '/overview', '/payouts', '/treats'])
api.use((req, res, next) => {
  const shared = req.method === 'GET' && !req.query.address && SHARED.has(req.path.replace(/\/$/, ''))
  res.setHeader('Cache-Control', shared ? 'public, max-age=0, s-maxage=5, stale-while-revalidate=10' : 'no-store')
  next()
})
for (const [name, router] of Object.entries(ROUTES)) api.use(`/${name}`, router)
api.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }))
// A route that throws answers with a clean error instead of an HTML stack trace.
api.use((err, _req, res, _next) => {
  console.error('[api]', err?.message || err)
  res.status(500).json({ ok: false, error: 'internal' })
})
app.use('/api', api)

module.exports = app
