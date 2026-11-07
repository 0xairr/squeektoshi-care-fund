// One transaction flow for every button: ask the wallet, wait for the chain, refresh the page data.
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getConnection } from 'wagmi/actions'
import { sendTransaction, useOpenConnect, waitForReceipt, walletErrorMessage, type TxRequest } from './wallet'
import { config } from './wagmi'

export interface TxStep {
  label: string // shown while this step is running, e.g. "Approve CARE"
  tx: TxRequest
}

export type TxState =
  | { kind: 'idle' }
  | { kind: 'signing'; label: string; step: number; steps: number }
  | { kind: 'mining'; label: string; step: number; steps: number; hash: string }
  | { kind: 'done'; hash: string }
  | { kind: 'error'; message: string; hash?: string }

const REFRESH = ['care', 'payouts', 'wallet', 'trades', 'burnPlan', 'ballot', 'airdrop']

export function useTx(refresh: string[] = REFRESH) {
  const [state, setState] = useState<TxState>({ kind: 'idle' })
  const queryClient = useQueryClient()
  const openConnect = useOpenConnect()

  const run = useCallback(
    async (steps: TxStep[]) => {
      if (getConnection(config).status !== 'connected') {
        openConnect()
        return false
      }
      let hash: string | undefined
      try {
        for (let i = 0; i < steps.length; i++) {
          const { label, tx } = steps[i]
          setState({ kind: 'signing', label, step: i + 1, steps: steps.length })
          hash = await sendTransaction(tx)
          setState({ kind: 'mining', label, step: i + 1, steps: steps.length, hash })
          await waitForReceipt(hash)
        }
        setState({ kind: 'done', hash: hash! })
        return true
      } catch (err) {
        setState({ kind: 'error', message: walletErrorMessage(err), hash })
        return false
      } finally {
        // Refresh now, and once more after the next block, when the backend has caught up.
        const refreshAll = () => refresh.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
        refreshAll()
        setTimeout(refreshAll, 6000)
      }
    },
    [queryClient, refresh, openConnect]
  )

  const busy = state.kind === 'signing' || state.kind === 'mining'
  const reset = useCallback(() => setState({ kind: 'idle' }), [])
  return { state, run, busy, reset }
}
