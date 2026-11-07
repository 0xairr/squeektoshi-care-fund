import { BTN, BTN_PRIMARY } from './Card'
import { HamsterWheel, type WheelMood } from './HamsterWheel'

const MOOD_LINE: Record<WheelMood, string> = {
  running: 'running right now',
  resting: 'resting',
  asleep: 'asleep',
}

/** A tilted sticker, the one decoration the hero allows itself. */
function Sticker({ children, tilt, className = '' }: { children: string; tilt: number; className?: string }) {
  return (
    <span
      className={`absolute rounded-full border-[2.5px] border-edge bg-card px-3.5 py-1.5 font-display text-[15px] text-ink shadow-pop-sm sm:text-[17px] ${className}`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {children}
    </span>
  )
}

/** The hero as pure markup. Hero.tsx feeds it live data; entry-server.tsx prerenders it with none, so
 *  the first paint is the same page the app then fills in. */
export function HeroView({
  ticker,
  mood,
  rpm,
  checking,
  days,
  launching,
}: {
  ticker: string
  mood: WheelMood
  rpm: number | null
  checking: boolean
  days: number | null
  launching: boolean
}) {
  return (
    <section className="border-b-[3px] border-edge bg-sun">
      <div className="mx-auto grid max-w-[1240px] items-center gap-6 px-4 pt-8 pb-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-12 lg:pb-14">
        <div>
          {launching && (
            <span className="inline-block rounded-full border-[2.5px] border-edge bg-cheek px-3.5 py-1 font-voice text-[14px] font-black text-ink">
              Launching soon on Sepolia
            </span>
          )}
          <h1 className="mt-4 font-display text-[88px] leading-[0.9] text-ink sm:text-[132px] lg:text-[150px]">${ticker}</h1>
          <p className="mt-3 max-w-[18ch] font-display text-[30px] leading-[1.05] text-ink sm:text-[38px]">
            Every trade feeds Squeektoshi.
          </p>
          <p className="mt-5 max-w-[44ch] font-voice text-[18px] leading-[1.6] font-bold text-ink2">
            <span className="mr-2 inline-block -rotate-2 rounded-full border-[2.5px] border-edge bg-card px-2.5 py-0.5 align-[2px] font-display text-[15px] leading-none text-ink">
              TL;DR
            </span>
            Squeektoshi is a real hamster whose running powers Squeekchain. 5% of every trade pays for his food, bedding
            and vet visits. Once his vault holds a month of care, the fee burns ${ticker}.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href="#buy" className={BTN_PRIMARY}>
              Buy ${ticker}
            </a>
            <a href="#donate" className={BTN}>
              Donate to his vault
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[460px]">
          <HamsterWheel mood={mood} rpm={rpm} className="h-auto w-full" />
          <Sticker tilt={-8} className="top-2 -left-1 sm:left-0">
            5% forever
          </Sticker>
          <Sticker tilt={6} className="top-10 -right-1 sm:right-0">
            LP burned
          </Sticker>
          <div className="relative -mt-3 rounded-[20px] border-[2.5px] border-edge bg-card px-4 py-3 shadow-pop-sm">
            <p className="font-voice text-[15px] font-extrabold text-ink">
              {checking
                ? 'Checking on Squeektoshi…'
                : `Squeektoshi is ${MOOD_LINE[mood]}${mood === 'running' && rpm ? `, ${rpm.toFixed(0)} rpm` : ''}.`}
            </p>
            <p className="mt-0.5 font-voice text-[14px] font-semibold text-ink2">
              {days === null ? 'His food money starts at launch.' : `${days} ${days === 1 ? 'day' : 'days'} of care in the vault.`}{' '}
              <a
                href="https://x.com/squeektoshi"
                target="_blank"
                rel="noreferrer"
                className="font-extrabold text-ink underline decoration-[2px] underline-offset-4 hover:text-hover"
              >
                Watch him on X
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
