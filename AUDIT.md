# Self-review, 2026-11-07

An internal review of the contracts in `contracts/src`, done before the Sepolia launch. It is not an
independent audit. Get one before anything holds real money.

Scope: `CareToken`, `CareVault`, `CareHook`, `BuybackBurner`, `CareBallot`, `CareAirdrop`,
`script/Deploy.s.sol` and the airdrop snapshot (`backend/scripts/snapshot.mjs`).
Tests: 89 unit tests (local PoolManager) and 6 fork tests against live Sepolia (`forge test`). One unit
test checks proofs from the real snapshot file against its root.

## Who can do what

| Function | Who | What it can do |
| --- | --- | --- |
| `CareVault.pay()` | anyone | Pays the keeper every whole week owed that the vault can cover. Money only goes to `keeper`. |
| `CareVault.retire()` | keeper or rescue | Starts the 30-day wind-down. Once. |
| `CareVault.sweep()` | anyone | First time: only after the grace period, or after 90 days with at least a week's allowance uncollected. Money only goes to `rescue`. |
| `BuybackBurner.burn()` | anyone | Spends the burner's ETH on CARE in this pool and sends it to `0x…dEaD`. |
| `BuybackBurner.bindHook()` | deployer, once | Links the burner to its hook. Refuses a hook that does not name this burner and pool. Done at deploy. |
| `CareHook` callbacks | PoolManager only | Take the 5% fee and route it. |
| `CareVault.bindBallot()` | deployer, once | Links the vault to its ballot. Refuses a ballot that does not name this vault. Done at deploy. |
| `CareVault.setMonthlyAllowance()` | ballot only | Sets the allowance, only between $300 and $1,000. |
| `CareBallot.vote()` | any CARE holder | Locks CARE in the current round behind one option. Voting again adds to the lock and moves all of it. |
| `CareBallot.withdraw()` | the voter | Returns their CARE from a round that is over. |
| `CareBallot.enact()` | anyone | Applies a finished round's weighted median to the vault. A round with no votes changes nothing. |
| `CareAirdrop.claim()` | anyone | Sends a snapshot wallet its amount, once, with a valid proof. The tokens only go to that wallet. |
| `CareAirdrop.burnUnclaimed()` | anyone, after 60 days | Sends what is left to `0x…dEaD`. |

Nothing has an owner or an upgrade path. The fee (5%) and the keeper and rescue addresses are fixed at
deploy. The only setting that can change is the monthly allowance, and only through a holders' vote,
inside $300 to $1,000.

## Fixed during the review

- A closed vault kept receiving fees with no way out. A swept vault now reports a zero shortfall, so
  every fee burns, and late donations can be swept again.
- The 90-day sweep could be triggered by anyone after a slow stretch. Silence now counts from the last
  real payout and only while the vault could pay a week.
- A price-feed timestamp in the future made the shortfall read revert inside swaps. It is now treated as
  an unusable price.
- The hook used to deploy the burner in its constructor. On current Sepolia, storing both contracts'
  code in one transaction exceeds the per-transaction gas cap, so the burner is deployed first and bound
  once.

## Known limits

1. **The burn's price guard reads the pool in the same transaction.** Someone could move the price
   first. What makes that unprofitable is the 5% fee on both legs of the move (about 10% round trip),
   which is far more than a burn of this size can give back.
2. **If the Chainlink feed goes stale**, the vault cannot price its cap: fees keep going to the vault
   (it can grow past one month), and `pay()` waits for a fresh price. Swaps keep working.
3. **If Chainlink retires the Sepolia feed for good**, payouts stop. The keeper or rescue can then
   `retire()` and `sweep()` what is left to the rescue.
4. **Keeper and rescue are the same Squeekchain team Safe** (1-of-1). Payouts and leftovers both go to
   that wallet. This is the intended design.
5. **The fee is charged on the full specified amount**, even if a swap with a tight price limit only
   partly fills. The site's swaps use no price limit.
6. **The deploy script must run with a high gas multiplier on Sepolia** (`--gas-estimate-multiplier
   1000`). Foundry's local gas rules price contract creation far lower than Sepolia currently does.
7. **A vote can be swung at the last minute.** Someone can buy CARE just before a round ends, lock it, and
   take it back right after. Flash loans don't work, because the CARE stays locked until the round is
   over, and the 5% fee on the buy and on the sell costs about 10%. Votes are weighted by CARE locked,
   not by wallet, and the result is the weighted median: a vote at one extreme wins only if it holds
   more than half of all the CARE locked that round.
8. **A round has to be enacted before a later one.** `enact` refuses rounds older than the last enacted
   one, so if a round with votes is left unenacted until the next round is over and someone enacts that
   later round first, the earlier result is skipped. The site shows an "Apply" button as soon as a round
   with votes ends.
9. **A new allowance applies to weeks already owed.** If `pay()` is late across an allowance change, the
   catch-up weeks are paid at the new rate.
10. **The airdrop trusts the snapshot.** The Merkle root is fixed at deploy; the contract cannot tell a
    wrong snapshot from a right one. The snapshot script, its output (`backend/data/airdrop.json`) and the
    block are public, so anyone can rebuild the tree and compare roots. The claims add up to 70M CARE
    minus 5,254 wei; that dust and anything unclaimed is burned after 60 days.
