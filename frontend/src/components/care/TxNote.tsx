import type { TxState } from '../../lib/useTx'

/** One line under a button that says what the transaction is doing, with a link once it exists. */
export function TxNote({ state, explorer, doneText }: { state: TxState; explorer: string; doneText: string }) {
  if (state.kind === 'idle') return null
  const link = (hash: string, text = 'view transaction') => (
    <a
      className="underline decoration-dotted underline-offset-2 hover:text-hover"
      href={`${explorer}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
    >
      {text}
    </a>
  )
  const steps = (s: { step: number; steps: number }) => (s.steps > 1 ? `Step ${s.step} of ${s.steps}: ` : '')

  return (
    <p className="mt-3 font-data text-[11px] leading-[1.6]" role="status" aria-live="polite">
      {state.kind === 'signing' && (
        <span className="text-ink2">
          {steps(state)}
          {state.label}. Confirm in your wallet.
        </span>
      )}
      {state.kind === 'mining' && (
        <span className="text-ink2">
          {steps(state)}
          {state.label}: waiting for Sepolia to include it… {link(state.hash)}
        </span>
      )}
      {state.kind === 'done' && (
        <span className="text-leaf">
          {doneText} {link(state.hash)}
        </span>
      )}
      {state.kind === 'error' && (
        <span className="text-cherry">
          {state.message} {state.hash && link(state.hash)}
        </span>
      )}
    </p>
  )
}
