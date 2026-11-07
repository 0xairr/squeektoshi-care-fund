import type { ReactNode } from 'react'

/* Shared class strings for the cage look: sticker panels with a brown ink outline, chunky pill buttons
   that press down, Bagel Fat One for figures and titles, Nunito for reading. */

export const LABEL = 'font-voice text-[13px] font-extrabold text-muted'
export const LABEL_WIDE = 'font-display text-[19px] leading-none text-ink'
export const VALUE = 'font-display text-[26px] leading-[1.05] tabular-nums'
export const VALUE_SM = 'font-display text-[19px] leading-[1.1] tabular-nums'
export const VOICE = 'font-voice text-[15px] leading-[1.55] font-semibold text-ink2'

const PRESS =
  'transition-[transform,box-shadow] duration-100 hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none'

export const BTN = `inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full border-[2.5px] border-edge bg-card px-5 font-voice text-[15px] font-extrabold text-ink shadow-pop-sm ${PRESS} disabled:cursor-not-allowed disabled:border-rule disabled:bg-card2 disabled:text-muted`

export const BTN_PRIMARY = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border-[2.5px] border-edge bg-wheel px-7 font-voice text-[16px] font-black text-white shadow-pop ${PRESS} disabled:cursor-not-allowed disabled:border-rule disabled:bg-card2 disabled:text-muted`

export const BTN_QUIET =
  'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full px-4 font-voice text-[15px] font-extrabold text-ink underline decoration-[2px] underline-offset-4 hover:text-hover'

export const INPUT_SHELL =
  'flex items-center gap-3 rounded-[16px] border-[2.5px] border-edge bg-card px-4 py-2 transition-colors focus-within:border-wheel'

/** A sticker panel: brown ink outline on a warm card. `pop` adds the hard shadow for things you act on. */
export function Panel({
  title,
  action,
  children,
  className = '',
  id,
  pop = false,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  pop?: boolean
}) {
  return (
    <section
      id={id}
      className={`relative isolate min-w-0 rounded-[22px] border-[2.5px] border-edge bg-card ${pop ? 'shadow-pop' : ''} ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-rule px-5 py-3.5">
          {title && <h2 className={LABEL_WIDE}>{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

const CHIP_TONES = {
  neutral: 'border-edge bg-card text-ink2',
  live: 'border-edge bg-[#cdf3da] text-ink',
  warn: 'border-edge bg-[#ffd9bf] text-ink',
  gold: 'border-edge bg-sun text-ink',
  blue: 'border-edge bg-[#d8e0ff] text-ink',
  off: 'border-rule bg-card2 text-muted',
  alarm: 'border-edge bg-[#ffd0d7] text-ink',
} as const

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof CHIP_TONES
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex min-h-[26px] shrink-0 items-center gap-1.5 rounded-full border-2 px-2.5 font-voice text-[12.5px] font-extrabold ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** A row in a ledger: label, display figure, hairline under. */
export function LedgerRow({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'gold' | 'care' | 'mute'
}) {
  const valueTone =
    tone === 'gold'
      ? 'text-amber'
      : tone === 'care'
        ? 'text-leaf'
        : tone === 'mute'
          ? 'text-muted'
          : 'text-ink'
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <span className={`${LABEL} leading-[1.4]`}>{label}</span>
      <span className="text-right">
        <span className={`${VALUE_SM} ${valueTone}`}>{value}</span>
        {hint && <span className="ml-2 font-data text-[11px] text-muted">{hint}</span>}
      </span>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-edge px-4 py-6 text-center">
      <span className="font-voice text-[13px] leading-[1.6] text-muted">{children}</span>
    </div>
  )
}

export function Skeleton({ className = 'h-4 w-24' }: { className?: string }) {
  return <span className={`block animate-pulse rounded-[8px] bg-card2 ${className}`} />
}

/** The fund's mark: Squeektoshi's wheel, blue with a sunflower hub. */
export function Mark({ className = 'h-7 w-7' }: { className?: string }) {
  const spokes = Array.from({ length: 6 }, (_, i) => {
    const t = (i / 6) * Math.PI * 2
    return <line key={i} x1="16" y1="16" x2={16 + 10 * Math.cos(t)} y2={16 + 10 * Math.sin(t)} stroke="#4b6bfb" strokeWidth="2.4" strokeLinecap="round" />
  })
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13.5" fill="#e3e9ff" stroke="#2b1d12" strokeWidth="2.5" />
      {spokes}
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="#4b6bfb" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="4" fill="#ffc83d" stroke="#2b1d12" strokeWidth="2" />
    </svg>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  id,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
  id?: string
}) {
  return (
    <div id={id} className="mt-14 mb-6 scroll-mt-28">
      {eyebrow && <div className="mb-3 font-voice text-[13px] font-bold text-amber">{eyebrow}</div>}
      <h2 className="font-display text-[40px] leading-[1.02] text-ink sm:text-[52px]">
        {title}
      </h2>
      {children && <p className={`${VOICE} mt-3 max-w-[62ch]`}>{children}</p>}
    </div>
  )
}

/** A run of square cells — the tile motif from the Squeekchain mark. */
export function Tiles({
  count = 4,
  columns = 4,
  color = 'var(--color-wheel)',
  className = '',
}: {
  count?: number
  columns?: number
  color?: string
  className?: string
}) {
  return (
    <span className={`grid gap-[2px] ${className}`} style={{ gridTemplateColumns: `repeat(${columns}, 6px)` }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="block h-[6px] w-[6px]" style={{ background: color }} />
      ))}
    </span>
  )
}
