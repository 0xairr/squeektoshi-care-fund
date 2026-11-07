import { useEffect, useState } from 'react'
import { useCare } from '../../lib/hooks'
import { fmtUsd } from '../../lib/format'

type Step = 'filling' | 'full' | 'payday'

const STEPS: Array<{ key: Step; tab: string }> = [
  { key: 'filling', tab: 'Vault filling' },
  { key: 'full', tab: 'Vault full' },
  { key: 'payday', tab: 'Payday' },
]

const INK = '#2b1d12'
const SUN = '#ffc83d'
const BLUE = '#4b6bfb'
const LEAF = '#1f9d55'
const PINK = '#ff8fa3'

// Paths the coins travel (viewBox 760 x 300).
const P_TRADE = 'M150 160 L262 160'
const P_CARE = 'M338 160 C 400 160, 405 96, 468 96'
const P_BURN = 'M338 160 C 400 160, 405 236, 470 236'
const P_PAY = 'M588 88 C 615 88, 625 88, 650 88'

function Coin({ path, dur, begin, color = SUN }: { path: string; dur: number; begin: number; color?: string }) {
  return (
    <circle r="9" fill={color} stroke={INK} strokeWidth="3">
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={path} />
    </circle>
  )
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** A looping picture of where the 5% goes: into the vault, or into the burn once it is full. */
export function MoneyFlow() {
  const { data: care } = useCare()
  const live: Step = care?.routing?.mode === 'burn' ? 'full' : 'filling'
  const [step, setStep] = useState<Step>(live)
  const [held, setHeld] = useState(false)

  // Cycle the three steps until someone picks one.
  useEffect(() => {
    if (held || prefersReducedMotion()) return
    const id = setInterval(() => {
      setStep((s) => STEPS[(STEPS.findIndex((x) => x.key === s) + 1) % STEPS.length].key)
    }, 5200)
    return () => clearInterval(id)
  }, [held])

  const weekly = fmtUsd(care?.weeklyUsd ?? 230.77)
  const cap = fmtUsd(care?.targetUsd ?? 1000, { decimals: 0 })
  const level = step === 'filling' ? 0.45 : step === 'full' ? 1 : 0.76
  const jarTop = 40
  const jarHeight = 120
  const fillHeight = jarHeight * level

  const caption: Record<Step, string> = {
    filling: `Someone buys or sells. 5% of the ETH goes straight into Squeektoshi's vault, until it holds a month of care (${cap}).`,
    full: `The vault is full, so the 5% now buys $CARE on the pool and burns it. The fee never switches off, it changes direction.`,
    payday: `Once a week the vault pays his keeper ${weekly}. That opens a gap, and the next fees fill the vault before anything burns.`,
  }

  return (
    <div className="rounded-[22px] border-[2.5px] border-edge bg-card p-4 sm:p-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="How the fee moves">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={step === s.key}
            onClick={() => {
              setStep(s.key)
              setHeld(true)
            }}
            className={`rounded-full border-[2.5px] border-edge px-3.5 py-1 font-voice text-[14px] font-extrabold transition-colors ${
              step === s.key ? 'bg-ink text-paper' : 'bg-card text-ink hover:bg-card2'
            }`}
          >
            {i + 1}. {s.tab}
          </button>
        ))}
        {live === 'full' ? (
          <span className="self-center font-voice text-[13px] font-bold text-muted">Right now: the vault is full.</span>
        ) : (
          <span className="self-center font-voice text-[13px] font-bold text-muted">Right now: the vault is filling.</span>
        )}
      </div>

      <svg viewBox="0 0 760 300" className="mt-4 h-auto w-full" role="img" aria-label={caption[step]}>
        {/* tracks */}
        <path d={P_TRADE} stroke={INK} strokeWidth="5" strokeDasharray="2 12" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d={P_CARE} stroke={step === 'full' ? '#d9c48c' : INK} strokeWidth="5" strokeDasharray="2 12" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d={P_BURN} stroke={step === 'full' ? INK : '#d9c48c'} strokeWidth="5" strokeDasharray="2 12" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d={P_PAY} stroke={INK} strokeWidth="5" strokeDasharray="2 12" strokeLinecap="round" fill="none" opacity="0.35" />

        {/* a trade */}
        <rect x="30" y="118" width="120" height="84" rx="20" fill="#d8e0ff" stroke={INK} strokeWidth="4" />
        <text x="90" y="152" textAnchor="middle" fontFamily="Bagel Fat One, system-ui" fontSize="22" fill={INK}>
          A trade
        </text>
        <text x="90" y="180" textAnchor="middle" fontFamily="Nunito, system-ui" fontWeight="800" fontSize="14" fill={INK}>
          buy or sell
        </text>

        {/* the 5% fee */}
        <circle cx="300" cy="160" r="38" fill={SUN} stroke={INK} strokeWidth="4" />
        <text x="300" y="169" textAnchor="middle" fontFamily="Bagel Fat One, system-ui" fontSize="26" fill={INK}>
          5%
        </text>

        {/* the vault jar */}
        <rect x="470" y={jarTop} width="118" height={jarHeight} rx="18" fill="#fffdf5" stroke={INK} strokeWidth="4" />
        <clipPath id="jar">
          <rect x="472" y={jarTop + 2} width="114" height={jarHeight - 4} rx="16" />
        </clipPath>
        <rect
          x="470"
          width="118"
          clipPath="url(#jar)"
          fill={step === 'full' ? LEAF : SUN}
          style={{ transition: 'y 900ms ease, height 900ms ease, fill 400ms' }}
          y={jarTop + jarHeight - fillHeight}
          height={fillHeight}
        />
        <rect x="462" y={jarTop - 12} width="134" height="18" rx="8" fill={BLUE} stroke={INK} strokeWidth="4" />
        <text x="529" y="186" textAnchor="middle" fontFamily="Bagel Fat One, system-ui" fontSize="20" fill={INK}>
          Vault
        </text>
        <text x="529" y={jarTop + jarHeight / 2 + 6} textAnchor="middle" fontFamily="Nunito, system-ui" fontWeight="900" fontSize="16" fill={INK}>
          {step === 'full' ? 'full' : step === 'payday' ? 'gap opened' : 'filling'}
        </text>

        {/* the burn */}
        <g transform="translate(500 205)">
          <path
            d="M30 64 C 4 64, -2 40, 12 22 C 14 34, 22 36, 22 36 C 20 18, 30 6, 40 0 C 40 16, 58 24, 58 42 C 58 56, 48 64, 30 64 Z"
            fill={step === 'full' ? '#ff7a3d' : '#f3d48a'}
            stroke={INK}
            strokeWidth="4"
            style={step === 'full' ? { transformOrigin: '30px 64px', animation: 'hop 0.5s ease-in-out infinite' } : undefined}
          />
          <text x="96" y="44" fontFamily="Bagel Fat One, system-ui" fontSize="20" fill={INK}>
            Burn
          </text>
        </g>

        {/* the keeper */}
        <g transform="translate(652 50)">
          <circle cx="14" cy="16" r="11" fill="#f4a640" stroke={INK} strokeWidth="4" />
          <circle cx="14" cy="16" r="5" fill={PINK} />
          <circle cx="66" cy="16" r="11" fill="#f4a640" stroke={INK} strokeWidth="4" />
          <circle cx="66" cy="16" r="5" fill={PINK} />
          <circle cx="40" cy="42" r="34" fill="#f4a640" stroke={INK} strokeWidth="4" />
          <ellipse cx="22" cy="52" rx="7" ry="5" fill={PINK} opacity="0.8" />
          <ellipse cx="58" cy="52" rx="7" ry="5" fill={PINK} opacity="0.8" />
          <ellipse cx="40" cy="50" rx="20" ry="14" fill="#fff0d4" />
          <circle cx="28" cy="36" r="5" fill={INK} />
          <circle cx="52" cy="36" r="5" fill={INK} />
          <circle cx="40" cy="47" r="4.5" fill={PINK} stroke={INK} strokeWidth="2.5" />
          <text x="40" y="104" textAnchor="middle" fontFamily="Bagel Fat One, system-ui" fontSize="18" fill={INK}>
            Keeper
          </text>
          <text x="40" y="124" textAnchor="middle" fontFamily="Nunito, system-ui" fontWeight="800" fontSize="13" fill={INK}>
            {weekly} / week
          </text>
        </g>

        {/* the coins: one moving picture per step */}
        <g key={step}>
          <Coin path={P_TRADE} dur={1.3} begin={0} />
          <Coin path={P_TRADE} dur={1.3} begin={0.65} />
          {step !== 'full' && <Coin path={P_CARE} dur={1.3} begin={0.65} />}
          {step !== 'full' && <Coin path={P_CARE} dur={1.3} begin={1.3} />}
          {step === 'full' && <Coin path={P_BURN} dur={1.3} begin={0.65} color="#ff7a3d" />}
          {step === 'full' && <Coin path={P_BURN} dur={1.3} begin={1.3} color="#ff7a3d" />}
          {step === 'payday' && <Coin path={P_PAY} dur={1} begin={0.2} color={LEAF} />}
        </g>
      </svg>

      <p className="mt-3 min-h-[3.2em] max-w-[64ch] font-voice text-[16px] leading-[1.55] font-bold text-ink" aria-live="polite">
        {caption[step]}
      </p>
    </div>
  )
}
