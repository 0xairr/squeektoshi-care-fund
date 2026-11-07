// Wallets, the way SqueekSwap does it: browser wallets are discovered by name (EIP-6963) with a generic
// injected fallback, and phone wallets connect over WalletConnect, created only when someone picks one.
import { createConfig, fallback, http } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

/**
 * Reown (WalletConnect) project ID, this site's own project. Public by design: it ships in every page.
 * The domains allowed to use it are set at cloud.reown.com (caretoshi.live is on the list).
 */
export const WALLETCONNECT_PROJECT_ID = 'eca0132b5dcfab9dd6ee4446107c49d1'

export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  // Reads (receipts) go to public Sepolia RPCs. VITE_SEPOLIA_RPC replaces them, e.g. for a local fork.
  transports: {
    [sepolia.id]: import.meta.env.VITE_SEPOLIA_RPC
      ? http(import.meta.env.VITE_SEPOLIA_RPC)
      : fallback([http('https://ethereum-sepolia-rpc.publicnode.com'), http('https://sepolia.gateway.tenderly.co')]),
  },
  ssr: false,
})

/** WalletConnect without its QR modal: the site opens the chosen phone wallet with the pairing link. */
export function walletConnectConnector() {
  return walletConnect({
    projectId: WALLETCONNECT_PROJECT_ID,
    showQrModal: false,
    metadata: {
      name: 'Squeektoshi Care Fund',
      description: 'A 5% swap fee that pays for a hamster’s care.',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://squeektoshi-care-fund.vercel.app',
      icons: [typeof window !== 'undefined' ? `${window.location.origin}/favicon.svg` : ''],
    },
  })
}

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
