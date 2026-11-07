// The connected wallet, through wagmi. Nothing connects until the visitor presses Connect: the site
// does not restore a session on load.
import { createContext, useContext } from 'react'
import { useConnection } from 'wagmi'
import { getConnection, sendTransaction as wagmiSend, switchChain, waitForTransactionReceipt } from 'wagmi/actions'
import { sepolia } from 'wagmi/chains'
import { config } from './wagmi'

export const SEPOLIA_ID = sepolia.id

/** Opens the connect dialog. Provided by ConnectProvider. */
export const ConnectContext = createContext<() => void>(() => {})
export const useOpenConnect = () => useContext(ConnectContext)

export function useAccount() {
  const { address, chainId, status } = useConnection()
  const connected = status === 'connected' && Boolean(address)
  return {
    account: connected ? (address as string) : null,
    chainId: chainId ?? null,
    onSepolia: chainId === SEPOLIA_ID,
  }
}

export interface TxRequest {
  to: string
  data?: string
  value?: bigint
}

/** Send from the connected wallet, switching it to Sepolia first if needed. */
export async function sendTransaction(tx: TxRequest): Promise<string> {
  const connection = getConnection(config)
  if (connection.status !== 'connected') throw new Error('Connect a wallet first.')
  if (connection.chainId !== SEPOLIA_ID) await switchChain(config, { chainId: SEPOLIA_ID })
  return wagmiSend(config, {
    chainId: SEPOLIA_ID,
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}` | undefined,
    value: tx.value,
  })
}

/** Wait until the transaction is mined. Resolves on success, throws if it reverted. */
export async function waitForReceipt(hash: string): Promise<void> {
  const receipt = await waitForTransactionReceipt(config, {
    chainId: SEPOLIA_ID,
    hash: hash as `0x${string}`,
    timeout: 300_000,
  })
  if (receipt.status !== 'success') throw new Error('The transaction was mined but reverted. Nothing was spent except gas.')
}

export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number; name?: string; message?: string; shortMessage?: string; cause?: { code?: number } }
  if (e?.code === 4001 || e?.cause?.code === 4001 || e?.name === 'UserRejectedRequestError' || /rejected|denied/i.test(e?.shortMessage ?? '')) {
    return 'You rejected it in your wallet.'
  }
  const msg = e?.shortMessage || e?.message || 'Something went wrong.'
  if (/insufficient funds/i.test(msg)) return 'Not enough Sepolia ETH for this and the gas.'
  if (/origin not allowed|not allowed/i.test(msg)) return 'WalletConnect is not enabled for this domain yet.'
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg
}
