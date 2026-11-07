# Squeektoshi Care Fund ($CARE)

A token on Sepolia whose swap fee pays for the care of Squeektoshi, the golden hamster whose wheel mines
[Squeekchain](https://squeekchain.com).

- Every buy and sell on the ETH/CARE Uniswap v4 pool pays **5% of the ETH side**. The fee never switches
  off, and nobody can change it.
- While the **CareVault** holds less than one month of care, the fee goes to the vault. A month of care
  starts at $1,000; CARE holders vote on it every 30 days, between $300 and $1,000.
- Once the vault is full, the fee goes to the **BuybackBurner**, which buys CARE on the same pool and
  sends it to `0x…dEaD`.
- The vault pays the keeper a week of the allowance (monthly × 12 / 52, so $230.77 at $1,000) in ETH at
  the Chainlink price. Anyone can trigger the payout; the money only goes to the keeper. Each payout
  opens a gap that the next fees fill first.
- **7% of the supply** is claimable by Squeek Genesis holders from a snapshot. The other **93% went into
  the pool** at launch, and the liquidity position was minted to the dead address. The deployer holds no
  tokens and cannot remove the liquidity.

A community project, not made or run by Squeekchain. Site: **https://caretoshi.live**

## Live on Sepolia

| Contract | Address |
| --- | --- |
| CARE token | [`0x5Eea836d4F39BD11b00EdA7f7004ad70C4b1732f`](https://sourcify.dev/#/lookup/0x5Eea836d4F39BD11b00EdA7f7004ad70C4b1732f) |
| CareVault | [`0x61Cdb9027610Ce7fFa8Fa0f6905dc9f9EFA8f8e8`](https://sourcify.dev/#/lookup/0x61Cdb9027610Ce7fFa8Fa0f6905dc9f9EFA8f8e8) |
| CareHook | [`0x45c6179Ebd078B4283924c8A8A7Ed91E7a6CC0CC`](https://sourcify.dev/#/lookup/0x45c6179Ebd078B4283924c8A8A7Ed91E7a6CC0CC) |
| BuybackBurner | [`0x2D0709f2a53e7b96ce9F39C8FBe498d070513552`](https://sourcify.dev/#/lookup/0x2D0709f2a53e7b96ce9F39C8FBe498d070513552) |
| CareBallot | [`0xDD71B58eD927f1BE5Fd1Ca8cD96757182db93a75`](https://sourcify.dev/#/lookup/0xDD71B58eD927f1BE5Fd1Ca8cD96757182db93a75) |
| CareAirdrop | [`0x0fC91d7436c4F402543d78f316EA05e929695205`](https://sourcify.dev/#/lookup/0x0fC91d7436c4F402543d78f316EA05e929695205) |
| Keeper and rescue | `0x3a83a80b9249eca85a9540ec878bd968f13cb676` (Squeekchain team Safe) |
| Liquidity | Uniswap v4 position #41503, owned by `0x000…dEaD` |

All six contracts are verified on Sourcify. Pool: ETH/CARE, LP fee 0, tick spacing 60, deployed at block
12082695. Airdrop snapshot: block 12082656, 2,982 wallets, claims open until 2027-01-06.

## How the money moves

```
 swap ──5%──▶ CareHook ──┬─ vault short of a month ─▶ CareVault ──weekly──▶ keeper
                         └─ vault full ─────────────▶ BuybackBurner ──buy CARE──▶ 0x…dEaD
```

At the starting allowance of $1,000 a month:

| Trading volume | What it does |
| --- | --- |
| $20,000 | fills an empty vault ($1,000 at 5%) |
| $4,615 | refills one weekly payout ($230.77) |
| anything above that | buys CARE back and burns it |

## For holders

### The Squeek airdrop (7%, 70M CARE)

Shares come from Squeek Genesis holdings at block 12082656. A Squeek is worth one share for every
original Squeek merged into it: level 1 is 1 share, level 2 is 2, level 3 is 4, and so on (2^(level−1)).
Merging neither gains nor loses airdrop. It follows the number of Squeeks, not their mining power
(power grows 2.2× per level, shares 2× per level).

- One share is **7,693 CARE**: 70M CARE ÷ 9,099 shares.
- At the snapshot there were 5,243 level-1 and 1,928 level-2 Squeeks, so a level-1 Squeek got 7,693 CARE
  and a level-2 got 15,386.
- A staked Squeek counts for the wallet that staked it. A Squeek sitting in a wallet counts too.
- The sale custodian and the protocol reserve are left out: 900 Squeeks.
- 2,982 wallets can claim until 2027-01-06. Then anyone can burn what is left.

### The vote on the allowance

Every 30 days holders vote on the next month's allowance: $300, $400 … $1,000.

- **Each CARE locked is one vote.** The number of wallets doesn't matter, and splitting CARE across
  wallets changes nothing.
- The CARE stays locked until the round ends, then you take it back. Voting again in the same round adds
  to your lock and moves all of it to your new choice.
- **The winner is the weighted median:** line every locked CARE up from $300 to $1,000, and the result is
  where the middle one sits. Example: 600 CARE on $300 and 500 CARE on $1,000 gives $300 (an average would
  have given $618). Whoever locks more than half of all the votes decides the round.
- A round nobody votes in leaves the allowance as it is. After a round ends, anyone can press Apply, which
  sets the vault's allowance and with it the weekly payout (monthly × 12 / 52).

## Contracts (`contracts/`, Foundry, solc 0.8.26)

| Contract | What it does |
| --- | --- |
| `CareToken` | Plain ERC-20, fixed supply minted once. No owner, no minting, no transfer fee, no blacklist. |
| `CareVault` | Holds the care money and prices it with Chainlink ETH/USD. Pays the keeper weekly and holds the end clause. Never reads SqueekCore, so the keeper is paid whether or not the wheel turns. |
| `CareHook` | v4 hook. Takes 5% of the ETH side in all four swap shapes, sends the vault what it is missing and the rest to the burner. Pinned to one pool key. Emits `FeeTaken(buy, fee, toCare, toBurn)`. |
| `BuybackBurner` | Spends its ETH on CARE in the same pool and sends it to `0x…dEaD`. No owner, no withdraw. A burn waits for 0.005 ETH and won't buy at more than 3% under the pool price. Bound to the hook once at deploy. |
| `CareBallot` | Holders lock CARE to vote on the monthly allowance for each 30-day round ($300 to $1,000 in $100 steps). The weighted median wins. CARE comes back after the round. Anyone can enact a finished round, which is the only way the vault's allowance changes. |
| `CareAirdrop` | 7% of the supply for Squeek Genesis holders. One claim per wallet with a Merkle proof, for 60 days. Then anyone can burn what is left. |

The end clause: the keeper or the rescue can `retire()` the fund. It keeps paying for 30 days, then
anyone can `sweep()` what is left to the rescue, and every fee after that is burned. If the vault holds at
least a week's allowance and nobody collects it for 90 days, anyone can sweep it too.

See [AUDIT.md](AUDIT.md) for who can call what and the known limits.

### Build and test

```bash
cd contracts
forge install foundry-rs/forge-std@v1.17.0 Uniswap/v4-core@v4.0.0 \
  Uniswap/v4-periphery@c6e4754dab11bd38c6f08ac51c3c868569e93d64 OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
forge test --no-match-contract SepoliaFork                            # 89 unit tests
SEPOLIA_RPC_URL=https://sepolia.gateway.tenderly.co forge test --match-contract SepoliaFork -vv
```

The fork tests run the real deploy script against the live PoolManager, PositionManager, Permit2 and
Chainlink feed. They then buy and sell through the live UniversalRouter with the same calldata the site
sends, burn, and pay the keeper.

### Deploy

```bash
cd backend && node scripts/snapshot.mjs           # writes data/airdrop.json: root, block, every claim
cd ../contracts
KEEPER=0x… RESCUE=0x… AIRDROP_ROOT=0x… AIRDROP_SNAPSHOT_BLOCK=… \
  forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow \
  --gas-estimate-multiplier 1000 --with-gas-price 3000 --priority-gas-price 1000 --private-key $PRIVATE_KEY
node script/wire.mjs      # copies deployments/11155111.json into backend/config/care.json
```

The snapshot reads every Squeek Genesis transfer up to the block. A Squeek counts 2^(level−1), one for
every Squeek merged into it; a staked Squeek counts for the wallet that staked it; the sale and reserve
wallets are left out.

One run deploys the token, the vault, the ballot (bound to the vault) and the funded airdrop, then the
burner. It deploys the hook at a mined CREATE2 address, binds the burner to it, opens the pool, and adds
the rest of the supply as one single-sided position minted to `0x…dEaD`. The high gas multiplier is
needed because Sepolia now charges far more for storing contract code than Foundry's local simulation
assumes. Set the gas price explicitly too: Foundry's default 1 gwei tip costs far more than Sepolia needs.

## The site (`backend/` + `frontend/`)

- **Live page:** the vault and how full it is, where the fee goes now, the burn, Squeektoshi's wheel
  (SqueekCore `state()` and the Squeekchain API), payouts, donations and recent trades.
- **Actions:** buy and sell through Uniswap's UniversalRouter (sells go through Permit2, with the
  one-time approvals shown as steps), donate, pay the keeper, burn, vote on the allowance, and claim
  the airdrop. Wallets connect through browser
  extensions or WalletConnect. Nothing connects until you press Connect. WalletConnect uses the site's
  own Reown project (`frontend/src/lib/wagmi.ts`), with caretoshi.live on its domain list.
- **Stream overlay** at `/#overlay` for OBS. Add `?test=1` to see a test treat.

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start        # http://localhost:3001
```

It is hosted on Vercel (`vercel.json`, with `api/index.js` serving the API). The Squeekchain API is read
from the visitor's browser, because it challenges requests from data centres.

## Genesis

squeekchain-project: pending
