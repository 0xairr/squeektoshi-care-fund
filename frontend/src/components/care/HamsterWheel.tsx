// Squeektoshi in his wheel, drawn as a sticker. The wheel turns at the real rpm the Squeekchain wheel
// reports, his legs run while it does, he stands still when the wheel is idle, and he curls up asleep
// when the wheel has gone quiet.

export type WheelMood = 'running' | 'resting' | 'asleep'

const INK = '#2b1d12'
const FUR = '#f4a640'
const CREAM = '#fff0d4'
const PINK = '#ff8fa3'
const PAW = '#f7b6a6'
const BLUE = '#4b6bfb'

const CX = 210
const CY = 200
const R = 168

function Rungs() {
  const rungs = Array.from({ length: 30 }, (_, i) => {
    const a = (i / 30) * Math.PI * 2
    const x1 = CX + (R - 22) * Math.cos(a)
    const y1 = CY + (R - 22) * Math.sin(a)
    const x2 = CX + (R - 2) * Math.cos(a)
    const y2 = CY + (R - 2) * Math.sin(a)
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="4" strokeLinecap="round" />
  })
  const spokes = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2
    return (
      <line
        key={i}
        x1={CX}
        y1={CY}
        x2={CX + (R - 22) * Math.cos(a)}
        y2={CY + (R - 22) * Math.sin(a)}
        stroke={BLUE}
        strokeWidth="9"
        strokeLinecap="round"
      />
    )
  })
  return (
    <>
      {spokes}
      {rungs}
    </>
  )
}

function AwakeHamster({ running }: { running: boolean }) {
  const legsA = running ? { animation: 'legs-a 0.32s ease-in-out infinite' } : undefined
  const legsB = running ? { animation: 'legs-b 0.32s ease-in-out infinite' } : undefined
  return (
    <g style={running ? { animation: 'hop 0.32s ease-in-out infinite' } : undefined}>
      {/* back paws */}
      <g style={legsB}>
        <ellipse cx="150" cy="352" rx="15" ry="9" fill={PAW} stroke={INK} strokeWidth="4" />
        <ellipse cx="232" cy="354" rx="14" ry="9" fill={PAW} stroke={INK} strokeWidth="4" />
      </g>
      {/* tail and ear sit behind the body */}
      <ellipse cx="122" cy="300" rx="12" ry="9" fill={FUR} stroke={INK} strokeWidth="5" />
      <circle cx="236" cy="226" r="18" fill={FUR} stroke={INK} strokeWidth="5" />
      <circle cx="236" cy="226" r="8" fill={PINK} />
      {/* body */}
      <ellipse cx="200" cy="298" rx="82" ry="56" fill={FUR} stroke={INK} strokeWidth="6" />
      <ellipse cx="214" cy="316" rx="50" ry="29" fill={CREAM} />
      {/* head: the muzzle and cheek are clipped to the inside of the outline, so the outline stays whole */}
      <clipPath id="sq-head-awake">
        <circle cx="264" cy="268" r="44" />
      </clipPath>
      <circle cx="264" cy="268" r="47" fill={FUR} stroke={INK} strokeWidth="6" />
      <g clipPath="url(#sq-head-awake)">
        <ellipse cx="288" cy="286" rx="27" ry="21" fill={CREAM} />
        <ellipse cx="258" cy="291" rx="13" ry="8" fill={PINK} opacity="0.85" />
      </g>
      <circle cx="274" cy="259" r="8.5" fill={INK} />
      <circle cx="277.5" cy="255.5" r="3" fill="#fff" />
      <circle cx="310" cy="279" r="6.5" fill={PINK} stroke={INK} strokeWidth="3" />
      <path d="M303 292 q5 6 11 0" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <line x1="305" y1="286" x2="338" y2="279" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="305" y1="292" x2="336" y2="297" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      {/* front paws */}
      <g style={legsA}>
        <ellipse cx="180" cy="356" rx="15" ry="9" fill={PAW} stroke={INK} strokeWidth="4" />
        <ellipse cx="262" cy="352" rx="14" ry="9" fill={PAW} stroke={INK} strokeWidth="4" />
      </g>
      <ellipse cx="282" cy="322" rx="13" ry="10" fill={FUR} stroke={INK} strokeWidth="4" />
    </g>
  )
}

function SleepingHamster() {
  return (
    <g>
      <circle cx="244" cy="270" r="16" fill={FUR} stroke={INK} strokeWidth="5" />
      <circle cx="244" cy="270" r="7" fill={PINK} />
      <ellipse cx="205" cy="318" rx="90" ry="46" fill={FUR} stroke={INK} strokeWidth="6" />
      <ellipse cx="200" cy="334" rx="56" ry="20" fill={CREAM} />
      <clipPath id="sq-head-asleep">
        <circle cx="268" cy="306" r="37" />
      </clipPath>
      <circle cx="268" cy="306" r="40" fill={FUR} stroke={INK} strokeWidth="6" />
      <g clipPath="url(#sq-head-asleep)">
        <ellipse cx="290" cy="320" rx="22" ry="16" fill={CREAM} />
        <ellipse cx="262" cy="324" rx="11" ry="7" fill={PINK} opacity="0.85" />
      </g>
      <path d="M266 302 q8 7 16 0" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="309" cy="316" r="6" fill={PINK} stroke={INK} strokeWidth="3" />
      {/* kept below the horizontal spoke and inside the rungs, including the 8px float of the snore animation */}
      <g fill={INK} fontFamily="Bagel Fat One, system-ui" fontSize="28">
        <text x="296" y="262" style={{ animation: 'snore 2.4s ease-in-out infinite' }}>
          z
        </text>
        <text x="322" y="246" fontSize="36" style={{ animation: 'snore 2.4s ease-in-out 0.8s infinite' }}>
          z
        </text>
      </g>
    </g>
  )
}

export function HamsterWheel({ mood, rpm, className = '' }: { mood: WheelMood; rpm: number | null; className?: string }) {
  const running = mood === 'running'
  // One turn every 60/rpm seconds, kept in a range the eye can follow.
  const seconds = running && rpm && rpm > 0 ? Math.min(6, Math.max(0.6, 60 / rpm)) : 0
  return (
    <svg viewBox="0 0 420 440" className={className} role="img" aria-label={`Squeektoshi, ${mood}`}>
      {/* stand */}
      <path d={`M${CX} ${CY} L120 418 M${CX} ${CY} L300 418`} stroke={INK} strokeWidth="14" strokeLinecap="round" />
      <path d={`M${CX} ${CY} L120 418 M${CX} ${CY} L300 418`} stroke="#c9d3ff" strokeWidth="6" strokeLinecap="round" />
      <rect x="40" y="412" width="340" height="16" rx="8" fill="#f3d48a" stroke={INK} strokeWidth="4" />
      {/* wheel */}
      <circle cx={CX} cy={CY} r={R} fill="#e3e9ff" stroke={INK} strokeWidth="8" />
      <g
        style={
          seconds
            ? { transformOrigin: `${CX}px ${CY}px`, transformBox: 'view-box', animation: `wheel-spin ${seconds}s linear infinite reverse` }
            : undefined
        }
      >
        <Rungs />
      </g>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke={BLUE} strokeWidth="14" />
      <circle cx={CX} cy={CY} r={R + 8} fill="none" stroke={INK} strokeWidth="5" />
      <circle cx={CX} cy={CY} r={R - 8} fill="none" stroke={INK} strokeWidth="4" />
      <circle cx={CX} cy={CY} r="20" fill={BLUE} stroke={INK} strokeWidth="6" />
      {mood === 'asleep' ? <SleepingHamster /> : <AwakeHamster running={running} />}
    </svg>
  )
}
