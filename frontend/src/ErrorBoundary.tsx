import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
        <div className="max-w-md rounded-[10px] border border-edge p-6">
          <p className="font-voice text-[15px] font-bold text-ink">Squeektoshi chewed a cable.</p>
          <p className="mt-3 font-voice text-[15px] leading-[1.5] text-ink2">
            The page hit an error it couldn&apos;t recover from. Reload and he&apos;ll be back.
          </p>
          <p className="mt-3 font-data text-[11px] break-words text-muted">{this.state.error.message}</p>
          <button
            onClick={() => location.reload()}
            className="mt-5 inline-flex min-h-[40px] items-center rounded-[4px] border border-ink bg-ink px-5 font-voice text-[14px] font-bold text-paper hover:border-hover hover:bg-hover"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
