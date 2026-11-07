// Small formatting helpers shared across the care page and the overlay.

export function fmtUsd(value: number | null | undefined, opts: { decimals?: number } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const decimals = opts.decimals ?? (Math.abs(value) >= 1000 ? 0 : 2)
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtEth(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ETH`
}

export function fmtWeiEth(wei: string | bigint | null | undefined, decimals = 5): string {
  if (wei === null || wei === undefined) return '—'
  const n = Number(wei) / 1e18
  if (!Number.isFinite(n)) return '—'
  return fmtEth(n, n !== 0 && Math.abs(n) < 10 ** -decimals ? 8 : decimals)
}

export function fmtNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr || addr.length < 10) return addr || '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function fmtKm(mm: number | string | null | undefined, decimals = 1): string {
  if (mm === null || mm === undefined) return '—'
  const n = Number(mm)
  if (!Number.isFinite(n)) return '—'
  return `${(n / 1e6).toFixed(decimals)} km`
}

export function fmtSpeed(mmPerSecond: number | null | undefined): string {
  if (mmPerSecond === null || mmPerSecond === undefined) return '—'
  return `${(Number(mmPerSecond) * 0.0036).toFixed(1)} km/h`
}

export function fmtRpm(rpmMilli: number | null | undefined): string {
  if (rpmMilli === null || rpmMilli === undefined) return '—'
  return `${(Number(rpmMilli) / 1000).toFixed(1)} rpm`
}

export function fmtCountdown(targetIso: string | number | null | undefined, nowMs = Date.now()): string {
  if (targetIso === null || targetIso === undefined) return '—'
  const target = typeof targetIso === 'number' ? targetIso * 1000 : Date.parse(targetIso)
  if (!Number.isFinite(target)) return '—'
  const diff = Math.max(0, Math.floor((target - nowMs) / 1000))
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function fmtRelative(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (!unixSeconds) return '—'
  const diff = Math.floor(nowMs / 1000) - unixSeconds
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function fmtDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Token amounts (18 decimals): 1.24M, 18,400, 0.42. */
export function fmtTokens(wei: bigint | string | null | undefined): string {
  if (wei === null || wei === undefined) return '—'
  return fmtTokenAmount(Number(BigInt(wei)) / 1e18)
}

export function fmtTokenAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** Whole days of the keeper's allowance a USD amount covers (weekly / 7 per day). */
export function daysOfCare(usd: number | null | undefined, weeklyUsd: number | null | undefined): number | null {
  if (usd === null || usd === undefined || !weeklyUsd || weeklyUsd <= 0) return null
  return Math.floor(usd / (weeklyUsd / 7))
}

/** "You fed Squeektoshi for about 16 hours": an ETH amount as time of the keeper's allowance. */
export function careHoursLine(eth: number | null, ethUsd: number | null, weeklyUsd: number | null): string | null {
  if (!eth || !ethUsd || !weeklyUsd || weeklyUsd <= 0) return null
  const hours = ((eth * ethUsd) / weeklyUsd) * 7 * 24
  if (hours < 1) return `You fed Squeektoshi for about ${Math.max(1, Math.round(hours * 60))} minutes.`
  if (hours < 48) return `You fed Squeektoshi for about ${Math.round(hours)} hours.`
  return `You fed Squeektoshi for about ${Math.round(hours / 24)} days.`
}
