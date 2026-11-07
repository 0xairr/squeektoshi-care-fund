// The Squeekchain public API, called from the visitor's browser. api.squeekchain.com allows any
// origin (CORS *), and its Cloudflare protection challenges datacenter servers, so these reads go
// straight from the page rather than through our backend.
import type { Overview } from './hooks'

const API = 'https://api.squeekchain.com'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`squeekchain ${path} -> ${res.status}`)
  return (await res.json()) as T
}

type Raw = Record<string, any>

export async function fetchWheelStatus(): Promise<Overview['status']> {
  const s = await get<Raw>('/v1/status')
  const m = s?.measurement
  if (!m) return null
  return {
    freshness: m.freshness ?? 'unknown',
    coreStatus: m.coreStatus ?? null,
    rpmMilli: m.rpmMilli ?? null,
    speedMmPerSecond: m.speedMmPerSecond ?? null,
    distanceMm: m.distanceMm ?? null,
    cumulativeWorkUnits: m.cumulativeWorkUnits ?? null,
    observedAt: m.observedAt ?? null,
  }
}
