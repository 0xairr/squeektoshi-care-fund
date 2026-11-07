// Client for the Squeekchain public API (api.squeekchain.com), used for the wheel status fallback.
// The page itself reads the API from the browser: Cloudflare challenges datacenter servers.
// TTLs respect the documented rate limits: status/core 5s, heavy reads 20-60s.
const { config } = require('./config')
const { cached } = require('./cache')

async function getJson(path, ttlMs) {
  return cached(`squeek:${path}`, ttlMs, async () => {
    try {
      const res = await fetch(`${config.squeekchainApi}${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'squeektoshi-care-fund/1.0 (community site)' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${body.slice(0, 160)}`)
      }
      return await res.json()
    } catch (err) {
      console.error(`[squeekchain] ${path}: ${err?.cause?.code || err?.message || err}`)
      throw err
    }
  })
}

const status = () => getJson('/v1/status', 5000)
const core = () => getJson('/v1/core', 5000)

// Trim /v1/status down to what the page shows.
function trimStatus(s) {
  if (!s || !s.measurement) return null
  const m = s.measurement
  return {
    freshness: m.freshness ?? 'unknown',
    coreStatus: m.coreStatus ?? null,
    rpmMilli: m.rpmMilli ?? null,
    speedMmPerSecond: m.speedMmPerSecond ?? null,
    distanceMm: m.distanceMm ?? null,
    cumulativeWorkUnits: m.cumulativeWorkUnits ?? null,
    observedAt: m.observedAt ?? null,
    staleAfterSeconds: m.staleAfterSeconds ?? null,
    settledThroughRound: s.builder?.anchor?.settledThroughRound ?? null,
    blockHeight: s.builder?.anchor?.blockHeight ?? null,
  }
}

module.exports = { status, core, trimStatus }
