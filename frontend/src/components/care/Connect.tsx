import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useConnect, useConnectors, useDisconnect, type Connector } from 'wagmi'
import { BTN } from './Card'
import { config, walletConnectConnector } from '../../lib/wagmi'
import { ConnectContext, SEPOLIA_ID, useAccount, walletErrorMessage } from '../../lib/wallet'
import { switchChain } from 'wagmi/actions'
import { shortAddr } from '../../lib/format'

const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Phone wallets that accept a WalletConnect pairing link directly, so no QR code is needed. */
const PHONE_WALLETS: Array<{ name: string; link: (uri: string) => string }> = [
  { name: 'MetaMask', link: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}` },
  { name: 'Trust Wallet', link: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` },
  { name: 'Rainbow', link: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}` },
]

/** Or open the whole page inside a wallet's own browser. */
function inAppLinks() {
  const here = `${location.host}${location.pathname}`
  return [
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${here}` },
    { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}` },
  ]
}

const OPTION =
  'flex w-full items-center gap-3 rounded-[8px] border border-edge px-3 py-2.5 text-left font-voice text-[14.5px] font-bold text-ink transition-colors hover:border-hover hover:text-hover disabled:opacity-50'

export function ConnectProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const connectors = useConnectors()
  const connect = useConnect()
  const [error, setError] = useState<string | null>(null)
  const [waitingFor, setWaitingFor] = useState<string | null>(null)

  const open = useCallback(() => {
    setError(null)
    dialog.current?.showModal()
  }, [])
  const close = () => dialog.current?.close()

  const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
  const generic = connectors.find((c) => c.id === 'injected')
  const hasInjected = typeof window !== 'undefined' && 'ethereum' in window
  const browserWallets = discovered.length > 0 ? discovered : hasInjected && generic ? [generic] : []
  const phone = isPhone()

  async function connectBrowserWallet(connector: Connector) {
    setError(null)
    try {
      await connect.mutateAsync({ connector, chainId: SEPOLIA_ID })
      close()
    } catch (err) {
      setError(walletErrorMessage(err))
    }
  }

  async function connectPhoneWallet(wallet: (typeof PHONE_WALLETS)[number]) {
    setError(null)
    setWaitingFor(wallet.name)
    // Set the connector up here so its pairing link can be caught and handed to the wallet app.
    const connector = config._internal.connectors.setup(walletConnectConnector())
    const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
      if (type === 'display_uri' && typeof data === 'string') window.location.href = wallet.link(data)
    }
    connector.emitter.on('message', onMessage)
    try {
      await connect.mutateAsync({ connector, chainId: SEPOLIA_ID })
      close()
    } catch (err) {
      setError(walletErrorMessage(err))
    } finally {
      connector.emitter.off('message', onMessage)
      setWaitingFor(null)
    }
  }

  return (
    <ConnectContext.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="connect-title"
        className="m-auto w-[min(92vw,380px)] rounded-[12px] border border-edge bg-card p-0 text-ink backdrop:bg-black/70"
        onClick={(e) => {
          if (e.target === dialog.current) close()
        }}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 id="connect-title" className="font-voice text-[16px] font-bold">
            Connect a wallet
          </h2>
          <button onClick={close} className="font-voice text-[13px] font-semibold text-muted hover:text-hover">
            Close
          </button>
        </div>
        <div className="space-y-4 p-4">
          {browserWallets.length > 0 && (
            <div>
              <div className="mb-2 font-voice text-[12.5px] font-semibold text-muted">On this device</div>
              <div className="space-y-2">
                {browserWallets.map((c) => (
                  <button key={c.uid} className={OPTION} disabled={connect.isPending} onClick={() => connectBrowserWallet(c)}>
                    {c.icon ? <img src={c.icon} alt="" width={24} height={24} /> : <span className="h-6 w-6 rounded-full bg-edge" />}
                    {c.id === 'injected' ? 'Browser wallet' : c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phone && (
            <div>
              <div className="mb-2 font-voice text-[12.5px] font-semibold text-muted">Phone wallets</div>
              <div className="space-y-2">
                {PHONE_WALLETS.map((w) => (
                  <button key={w.name} className={OPTION} disabled={connect.isPending} onClick={() => connectPhoneWallet(w)}>
                    <span className="h-6 w-6 rounded-full bg-edge" />
                    {waitingFor === w.name ? `Opening ${w.name}…` : w.name}
                  </button>
                ))}
              </div>
              <div className="mt-3 font-voice text-[12.5px] text-muted">
                Or open this page inside{' '}
                {inAppLinks().map((l, i) => (
                  <span key={l.name}>
                    {i > 0 && ' or '}
                    <a className="font-bold text-ink2 underline decoration-dotted underline-offset-2" href={l.href}>
                      {l.name}
                    </a>
                  </span>
                ))}
                .
              </div>
            </div>
          )}

          {browserWallets.length === 0 && !phone && (
            <p className="font-voice text-[14px] leading-[1.55] text-ink2">
              No wallet in this browser. Install{' '}
              <a className="font-bold underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                MetaMask
              </a>{' '}
              or{' '}
              <a className="font-bold underline" href="https://rabby.io" target="_blank" rel="noreferrer">
                Rabby
              </a>
              , or open this page on your phone.
            </p>
          )}

          {error && <p className="font-voice text-[13px] text-cherry">{error}</p>}
          <p className="font-voice text-[12px] leading-[1.5] text-muted">
            Sepolia testnet. Your wallet signs everything; this site never holds keys or funds.
          </p>
        </div>
      </dialog>
    </ConnectContext.Provider>
  )
}

/** Header button: Connect, or the connected address with a small menu to switch network or disconnect. */
export function ConnectButton({ onOpen }: { onOpen: () => void }) {
  const { account, onSepolia } = useAccount()
  const disconnect = useDisconnect()
  const [menu, setMenu] = useState(false)

  if (!account) {
    return (
      <button onClick={onOpen} className={`${BTN} min-h-[38px] px-4 whitespace-nowrap`}>
        Connect wallet
      </button>
    )
  }
  return (
    <span className="relative">
      <button onClick={() => setMenu((m) => !m)} className={`${BTN} min-h-[38px] px-4 whitespace-nowrap`} aria-expanded={menu}>
        {onSepolia ? shortAddr(account) : 'Wrong network'}
      </button>
      {menu && (
        <span className="absolute right-0 z-30 mt-2 w-[200px] rounded-[10px] border border-edge bg-card p-2 shadow-lg">
          {!onSepolia && (
            <button
              className="block w-full rounded-[6px] px-3 py-2 text-left font-voice text-[14px] font-bold text-ink hover:bg-card2"
              onClick={() => switchChain(config, { chainId: SEPOLIA_ID }).finally(() => setMenu(false))}
            >
              Switch to Sepolia
            </button>
          )}
          <button
            className="block w-full rounded-[6px] px-3 py-2 text-left font-voice text-[14px] font-bold text-ink hover:bg-card2"
            onClick={() => {
              disconnect.mutate()
              setMenu(false)
            }}
          >
            Disconnect
          </button>
        </span>
      )}
    </span>
  )
}
