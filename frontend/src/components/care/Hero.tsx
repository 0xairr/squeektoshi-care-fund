import { HeroView } from './HeroView'
import type { WheelMood } from './HamsterWheel'
import { useCare, useConfig, useWheelStatus } from '../../lib/hooks'
import { daysOfCare } from '../../lib/format'
import { SITE } from '../../lib/site'

export function Hero() {
  const { data: config } = useConfig()
  const { data: care } = useCare()
  const wheel = useWheelStatus()

  const rpm = wheel?.rpmMilli != null ? wheel.rpmMilli / 1000 : null
  const online = wheel?.freshness === 'online'
  const mood: WheelMood = !online ? 'asleep' : rpm != null && rpm > 0 ? 'running' : 'resting'

  return (
    <HeroView
      ticker={config?.ticker ?? SITE.ticker}
      mood={mood}
      rpm={rpm}
      checking={!wheel}
      days={daysOfCare(care?.balanceUsd ?? null, care?.weeklyUsd ?? null)}
      launching={Boolean(care && !care.wired)}
    />
  )
}
