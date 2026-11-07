import { LABEL, LedgerRow, Panel, VALUE_SM } from './Card'
import { useOverview, useWheelStatus } from '../../lib/hooks'
import { fmtKm, fmtNumber, fmtRelative, fmtRpm, fmtSpeed } from '../../lib/format'

function statusText(coreStatus: string | null, paused: boolean | null): string {
  if (paused) return 'Settlement paused'
  if (!coreStatus) return 'No reading yet'
  const key = coreStatus.toUpperCase()
  if (key === 'RUNNING') return 'Running'
  if (key === 'IDLE') return 'Idle'
  return coreStatus.charAt(0) + coreStatus.slice(1).toLowerCase()
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className={`${VALUE_SM} mt-1.5 text-ink`}>{value}</div>
    </div>
  )
}

export function WheelCard() {
  const { data, isLoading, isError } = useOverview()
  const status = useWheelStatus()
  const paused = data?.core?.paused ?? null
  const rpm = status?.rpmMilli ?? null
  const roundEndsIn =
    data?.round != null ? Math.max(0, Math.floor((data.round.endsAt * 1000 - Date.now()) / 60000)) : null

  return (
    <Panel
      title="Squeektoshi’s wheel"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <div>
          <div className="font-display text-[26px] leading-none text-ink">
            {statusText(status?.coreStatus ?? null, paused)}
          </div>
          <p className="mt-2 font-data text-[11px] leading-[1.5] text-muted">
            {status?.observedAt
              ? `last reading ${fmtRelative(Math.floor(Date.parse(status.observedAt) / 1000))}`
              : 'waiting for the first reading from Squeekchain'}
          </p>
        </div>
        <div className="text-right">
          <div className={LABEL}>Wheel</div>
          <div className={`${VALUE_SM} mt-1.5 text-amber`}>{fmtRpm(rpm)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
        <Figure label="Distance today" value={fmtKm(status?.distanceMm ?? null)} />
        <Figure label="Speed" value={fmtSpeed(status?.speedMmPerSecond ?? null)} />
        <Figure
          label="Wheel work, all time"
          value={status?.cumulativeWorkUnits ? `${fmtNumber(status.cumulativeWorkUnits)} units` : '—'}
        />
        <Figure label="Round" value={data?.round ? `#${fmtNumber(data.round.current)}` : '—'} />
      </div>

      <div className="mt-5">
        <LedgerRow label="Settled through round" value={data?.core ? fmtNumber(data.core.settledThroughRound) : '—'} />
        <LedgerRow label="Squeek height" value={data?.core ? fmtNumber(data.core.blockHeight) : '—'} />
        <LedgerRow
          label="Difficulty"
          value={data?.core ? `${fmtNumber(data.core.workPerThousandBlocks)}` : '—'}
          hint="per 1k blocks"
        />
        <LedgerRow label="Round ends" value={roundEndsIn !== null ? `${roundEndsIn}m` : '—'} />
      </div>

      {isLoading && !data && <p className="mt-4 font-data text-[11px] text-muted">reading Squeekchain…</p>}
      {isError && (
        <p className="mt-4 font-voice text-[12.5px] leading-[1.6] text-muted">
          Can&apos;t reach Squeekchain right now. The page keeps retrying.
        </p>
      )}
    </Panel>
  )
}
