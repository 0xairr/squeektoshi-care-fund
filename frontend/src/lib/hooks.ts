// TanStack Query hooks for every backend route the site uses.
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchWheelStatus } from './squeekchain'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(api(path), { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return (await res.json()) as T
}

export interface PoolKey {
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
}

export interface SiteConfig {
  name: string
  ticker: string
  network: { name: string; chainId: number }
  explorer: string
  economics: { feeBps: number; monthlyAllowanceUsd: number; payoutIntervalSeconds: number }
  burn: { burnAddress: string; minEthToBurn: number; maxSlippageBps: number }
  wired: { vault: boolean; pool: boolean }
  addresses: {
    token: string | null
    vault: string | null
    hook: string | null
    keeper: string | null
    rescue: string | null
    poolManager: string | null
    router: string | null
    quoter: string | null
    permit2: string | null
    squeekCore: string | null
    ballot: string | null
    airdrop: string | null
  }
  pool: (PoolKey & { poolId: string }) | null
  links: { squeekchain: string; docs: string }
}

export interface Overview {
  ok: boolean
  status: {
    freshness: string
    coreStatus: string | null
    rpmMilli: number | null
    speedMmPerSecond: number | null
    distanceMm: number | null
    cumulativeWorkUnits: string | null
    observedAt: string | null
  } | null
  core: {
    settledThroughRound: number
    cumulativeWork: string
    blockHeight: number
    workPerThousandBlocks: number
    paused: boolean | null
  } | null
  round: { current: number; endsAt: number } | null
}

export interface BurnStats {
  wired: boolean
  burner: string | null
  burnAddress: string
  burnedTokens?: number
  pendingEth?: number
  minEthToBurn?: number
  maxSlippageBps?: number
  burnCount?: number
  burnedEth?: number
  recent?: Array<{ ethIn: number; tokensBurned: number; caller: string; blockNumber: number; txHash: string }>
}

export interface Care {
  ok: boolean
  wired: boolean
  ethUsd: { usd: number; updatedAt: number; stale: boolean } | null
  feeBps: number
  balanceEth: number | null
  balanceUsd: number | null
  targetUsd: number
  monthlyAllowanceUsd: number
  weeklyUsd: number
  weeklyEth: number | null
  payoutIntervalSeconds: number
  progressPct: number | null
  funded: boolean | null
  routing: { mode: 'care' | 'burn'; shortfallEth: number | null; shortfallUsd: number | null }
  nextPayoutAt: string | null
  weeksOwed: number
  canPay: boolean
  closed: boolean
  retiredAt: number | null
  lastPayout: { amountEth: number; weeksPaid: number | null; txHash: string; blockNumber: number } | null
  burn: BurnStats | null
  totals: { swaps: number; feeEth: number; toCareEth: number; toBurnEth: number } | null
  keeper: string | null
  rescue: string | null
  vaultAddress: string | null
}

export interface Payouts {
  ok: boolean
  wired: boolean
  events: Array<{
    kind: 'payout' | 'donation' | 'sweep' | 'retire' | 'other'
    amountEth: number
    amountUsdToday: number | null
    weeksPaid: number | null
    from: string | null
    timestamp: number | null
    txHash: string
    blockNumber: number
  }>
  totals: { payoutsEth: number; donationsEth: number; feesEth: number; feeCount: number }
}



export interface Trade {
  txHash: string
  blockNumber: number
  side: 'buy' | 'sell' | 'burn'
  ethWei: string
  feeWei: string
  tokenWei: string
  trader: string | null
}

export interface Trades {
  ok: boolean
  wired: boolean
  latestBlock: number | null
  count: number
  trades: Trade[]
}

export interface Quote {
  ok: boolean
  wired: boolean
  side: 'buy' | 'sell'
  amountInWei: string
  amountOutWei?: string
  impactBps?: number | null
  error?: string
}

export interface Wallet {
  ok: boolean
  address: string
  ethWei: string
  tokenWei: string | null
  tokenAllowanceToPermit2Wei?: string
  permit2?: { amountWei: string; expiration: number }
}

export interface BurnPlan {
  ok: boolean
  ready: boolean
  reason?: 'not_deployed' | 'below_minimum' | 'pool_too_thin' | 'unavailable'
  burner?: string
  ethInWei?: string
  minTokensOutWei?: string
  pendingWei?: string
  minWei?: string
}

export const useConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => fetchJson<SiteConfig>('config'), staleTime: 60_000 })

export const useOverview = () =>
  useQuery({ queryKey: ['overview'], queryFn: () => fetchJson<Overview>('overview'), refetchInterval: 30_000 })

export const useCare = () =>
  useQuery({ queryKey: ['care'], queryFn: () => fetchJson<Care>('care'), refetchInterval: 30_000 })

export const usePayouts = () =>
  useQuery({ queryKey: ['payouts'], queryFn: () => fetchJson<Payouts>('payouts'), refetchInterval: 60_000 })

// The wheel status is read from the browser (see lib/squeekchain.ts).
/** The wheel right now: the browser asks Squeekchain, the backend's copy is the fallback. */
export function useWheelStatus() {
  const browser = useQuery({ queryKey: ['wheel'], queryFn: fetchWheelStatus, refetchInterval: 15_000 })
  const overview = useOverview()
  return browser.data ?? overview.data?.status ?? null
}

export const useQuote = (side: 'buy' | 'sell', amount: string, enabled: boolean) =>
  useQuery({
    queryKey: ['quote', side, amount],
    queryFn: () => fetchJson<Quote>(`quote?side=${side}&amount=${encodeURIComponent(amount)}`),
    enabled: enabled && Number(amount) > 0,
    refetchInterval: 15_000,
    retry: 1,
  })

export const useWallet = (address: string | null) =>
  useQuery({
    queryKey: ['wallet', address],
    queryFn: () => fetchJson<Wallet>(`wallet?address=${address}`),
    enabled: Boolean(address),
    refetchInterval: 30_000,
  })

export const useBurnPlan = (enabled: boolean) =>
  useQuery({ queryKey: ['burnPlan'], queryFn: () => fetchJson<BurnPlan>('burn'), enabled, refetchInterval: 30_000 })

export const useTrades = (since: number | null, refetchMs = 5000) =>
  useQuery({
    queryKey: ['trades', since],
    queryFn: () => fetchJson<Trades>(`treats${since ? `?since=${since}` : ''}`),
    refetchInterval: refetchMs,
    staleTime: 1000,
  })

export interface Ballot {
  ok: boolean
  wired: boolean
  ballot?: string
  round?: number
  endsAt?: number
  weights?: string[]
  leading?: { monthlyUsd: number; totalLocked: string }
  monthlyAllowanceUsd?: number
  previous?: { round: number; monthlyUsd: number; totalLocked: string; canEnact: boolean } | null
  me?: {
    allowanceWei: string
    option: number | null
    lockedNowWei: string
    withdrawable: Array<{ round: number; amountWei: string }>
  } | null
}

export interface Airdrop {
  ok: boolean
  wired: boolean
  airdrop?: string
  wallets?: number
  matches?: boolean
  deadline?: number
  snapshotBlock?: number
  unclaimedWei?: string
  me?: { eligible: boolean; account?: string; amountWei?: string; proof?: string[]; claimed?: boolean } | null
}

export const useBallot = (address: string | null) =>
  useQuery({
    queryKey: ['ballot', address],
    queryFn: () => fetchJson<Ballot>(`ballot${address ? `?address=${address}` : ''}`),
    refetchInterval: 60_000,
  })

export const useAirdrop = (address: string | null) =>
  useQuery({
    queryKey: ['airdrop', address],
    queryFn: () => fetchJson<Airdrop>(`airdrop${address ? `?address=${address}` : ''}`),
  })
