// Small in-memory TTL caches with a size bound, plus JSON-safe conversion (BigInt -> string).
// They keep upstream reads (Squeekchain API, RPC) inside their rate limits, join concurrent callers
// onto one request, and serve the last good value when an upstream hiccups.
//
// Two separate stores: one for shared data (vault state, events, prices) and one for entries whose
// key comes from a visitor (a quote amount, a wallet address). Visitors can only churn their own
// store, so they can never push the shared data out.

function createCache(maxEntries) {
  const store = new Map()
  const inflight = new Map()

  function remember(key, value) {
    store.delete(key) // re-insert so iteration order stays oldest-first
    store.set(key, { at: Date.now(), value })
    while (store.size > maxEntries) store.delete(store.keys().next().value)
  }

  return async function cached(key, ttlMs, fn) {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value
    if (inflight.has(key)) return inflight.get(key)

    const p = (async () => {
      try {
        const value = await fn()
        remember(key, value)
        return value
      } catch (err) {
        if (hit) return hit.value // stale-on-error beats a broken page
        throw err
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
    return p
  }
}

const cached = createCache(1000)
const visitorCached = createCache(500)

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)))
}

function bigAbs(v) {
  return v < 0n ? -v : v
}

module.exports = { cached, visitorCached, jsonSafe, bigAbs }
