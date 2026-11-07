// The whole site in one process: the JSON API under /api, and the built frontend for everything else.
//
//   PORT              port to listen on (default 3001)
//   SEPOLIA_RPC_URL   optional: an RPC to try before the public fallbacks
//   RPC_URLS          optional: comma-separated RPCs to use instead of all of the above
//   CARE_CONFIG       optional: path to a config file other than config/care.json
//   TRUST_PROXY       set when running behind a reverse proxy (Vercel, Render, nginx): the number
//                     of proxy hops to trust for the client IP. Leave unset otherwise, so the rate
//                     limit uses the real socket address and cannot be dodged with X-Forwarded-For.
//
// Dev: run this, then `npm run dev` in ../frontend (Vite proxies /api here).
// Production: `npm run build` in ../frontend, then `node server.js`.
const path = require('node:path')
const fs = require('node:fs')
const express = require('express')
const app = require('./app')

const PORT = Number.parseInt(process.env.PORT || '3001', 10)
const client = path.join(__dirname, '..', 'frontend', 'dist', 'client')
const indexFile = path.join(client, 'index.html')

if (fs.existsSync(indexFile)) {
  // The build already carries the static shell and the Genesis tag (frontend/scripts/prerender.mjs).
  const html = fs.readFileSync(indexFile, 'utf8')
  app.use('/assets', express.static(path.join(client, 'assets'), { immutable: true, maxAge: '365d', index: false }))
  app.use(express.static(client, { index: false, maxAge: '1h' }))
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(html)
  })
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('API is running. Build the frontend (cd frontend && npm run build) to serve the site here.')
  )
}

app.listen(PORT, () => console.log(`care fund listening on http://localhost:${PORT}`))
