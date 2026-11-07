// Why the fund exists. Facts about Syrian hamsters, and the care rules Squeekchain publishes for
// Squeektoshi (docs.squeekchain.com). No invented prices.

const NEEDS: Array<[string, string]> = [
  ['Fresh food every day', 'A Syrian hamster eats seeds, grains, fresh vegetables and a little protein, and hoards it in his cheeks.'],
  ['Deep bedding and a big home', 'He burrows, so he needs deep bedding changed regularly, in an enclosure of at least 100 × 50 cm.'],
  ['Things to chew', 'His teeth never stop growing. Chews and wooden toys keep them short and him healthy.'],
  ['A vet when he needs one', 'Hamsters need an exotic-pet vet, and they only live two to three years, so problems can’t wait.'],
  ['The wheel and the camera', 'A solid 30 cm wheel, the sensors that read it, a night-vision camera and the computer behind them all run day and night.'],
]

export function WhyCare() {
  return (
    <section id="why" className="mt-14 scroll-mt-28">
      <div className="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="font-display text-[40px] leading-[1.02] text-ink sm:text-[52px]">Why he needs care</h2>
          <p className="mt-4 max-w-[46ch] font-voice text-[17px] leading-[1.55] font-bold text-ink2">
            Squeektoshi is a real golden hamster, not a mascot. His wheel powers Squeekchain, and someone looks after him
            every day.
          </p>
          <p className="mt-4 max-w-[46ch] font-voice text-[15px] leading-[1.55] font-semibold text-ink2">
            Squeekchain&apos;s care rules say he only runs when he wants to, and that mining stops if it ever gets in the way
            of his care. This fund pays for that care, so it never depends on the price of anything.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {NEEDS.map(([title, body]) => (
            <li key={title} className="rounded-[20px] border-[2.5px] border-edge bg-card p-4">
              <div className="font-display text-[19px] leading-tight text-ink">{title}</div>
              <p className="mt-1.5 font-voice text-[14px] leading-[1.5] font-semibold text-ink2">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
