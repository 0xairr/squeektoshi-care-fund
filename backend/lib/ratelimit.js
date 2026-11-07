// Fixed-window rate limit per client IP, in memory. Enough to stop one visitor from turning the
// site into a free RPC proxy; the upstream caches do the rest.
function rateLimit({ windowMs, max, maxClients = 20_000 }) {
  const hits = new Map()
  setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [ip, entry] of hits) if (entry.start < cutoff) hits.delete(ip)
  }, windowMs).unref()

  return (req, res, next) => {
    const ip = req.ip || 'unknown'
    const now = Date.now()
    let entry = hits.get(ip)
    if (!entry || now - entry.start >= windowMs) {
      // A flood of distinct addresses must not grow the table without bound: drop the oldest.
      if (!entry && hits.size >= maxClients) hits.delete(hits.keys().next().value)
      entry = { start: now, count: 0 }
      hits.delete(ip)
      hits.set(ip, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)))
      return res.status(429).json({ ok: false, error: 'rate_limited' })
    }
    next()
  }
}

module.exports = { rateLimit }
