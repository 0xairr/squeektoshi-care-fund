// GET /api/ballot[?address=0x…] — the holders' vote on the monthly allowance: this round's tally, the
// last round's result and whether it still needs enacting, and (with an address) that wallet's lock.
const { Router } = require('express')
const { parseAbi, isAddress, getAddress } = require('viem')
const { client, latestBlock } = require('../lib/chain')
const { config } = require('../lib/config')
const { cached, visitorCached, jsonSafe } = require('../lib/cache')

const BALLOT_ABI = parseAbi([
  'function currentRound() view returns (uint256)',
  'function roundEnds(uint256 round) view returns (uint256)',
  'function weights(uint256 round) view returns (uint256[8])',
  'function result(uint256 round) view returns (uint256 monthlyUsd, uint256 totalLocked)',
  'function enactedThrough() view returns (uint256)',
  'function locked(uint256 round, address voter) view returns (uint256)',
  'function choiceOf(uint256 round, address voter) view returns (uint8 option, bool voted)',
])
const VAULT_ABI = parseAbi(['function monthlyAllowanceUsd() view returns (uint256)'])
const ERC20_ABI = parseAbi(['function allowance(address owner, address spender) view returns (uint256)'])

const router = Router()

async function readBallot(ballot) {
  const head = await latestBlock()
  return cached(`ballot:${ballot}:${head}`, 60_000, async () => {
    const round = await client.readContract({ address: ballot, abi: BALLOT_ABI, functionName: 'currentRound' })
    const prev = round > 0n ? round - 1n : null
    const calls = [
      { address: ballot, abi: BALLOT_ABI, functionName: 'roundEnds', args: [round] },
      { address: ballot, abi: BALLOT_ABI, functionName: 'weights', args: [round] },
      { address: ballot, abi: BALLOT_ABI, functionName: 'result', args: [round] },
      { address: ballot, abi: BALLOT_ABI, functionName: 'enactedThrough' },
      { address: config.addresses.vault, abi: VAULT_ABI, functionName: 'monthlyAllowanceUsd' },
      ...(prev !== null ? [{ address: ballot, abi: BALLOT_ABI, functionName: 'result', args: [prev] }] : []),
    ]
    const [ends, weights, current, enactedThrough, allowance, previous] = await client.multicall({
      contracts: calls,
      allowFailure: false,
    })
    return {
      round: Number(round),
      endsAt: Number(ends),
      weights: weights.map((w) => w.toString()),
      leading: { monthlyUsd: Number(current[0]), totalLocked: current[1].toString() },
      monthlyAllowanceUsd: Number(allowance) / 1e8,
      previous:
        prev !== null
          ? {
              round: Number(prev),
              monthlyUsd: Number(previous[0]),
              totalLocked: previous[1].toString(),
              canEnact: BigInt(enactedThrough) <= prev,
            }
          : null,
    }
  })
}

router.get('/', async (req, res) => {
  const ballot = config.addresses.ballot
  if (!ballot) return res.json({ ok: true, wired: false })
  try {
    const state = await readBallot(ballot)
    let me = null
    const address = String(req.query.address ?? '')
    if (isAddress(address)) {
      const voter = getAddress(address)
      me = await visitorCached(`ballot:me:${voter}:${state.round}`, 4000, async () => {
        // the current round, plus the last three for CARE that can be taken back
        const rounds = [state.round, state.round - 1, state.round - 2, state.round - 3].filter((r) => r >= 0)
        const contracts = [
          { address: config.addresses.token, abi: ERC20_ABI, functionName: 'allowance', args: [voter, ballot] },
          { address: ballot, abi: BALLOT_ABI, functionName: 'choiceOf', args: [BigInt(state.round), voter] },
          ...rounds.map((r) => ({ address: ballot, abi: BALLOT_ABI, functionName: 'locked', args: [BigInt(r), voter] })),
        ]
        const [allowance, choice, ...locks] = await client.multicall({ contracts, allowFailure: false })
        return {
          allowanceWei: allowance.toString(),
          option: choice[1] ? Number(choice[0]) : null,
          lockedNowWei: locks[0].toString(),
          withdrawable: rounds
            .slice(1)
            .map((r, i) => ({ round: r, amountWei: locks[i + 1].toString() }))
            .filter((x) => x.amountWei !== '0'),
        }
      })
    }
    res.json(jsonSafe({ ok: true, wired: true, ballot, ...state, me }))
  } catch {
    res.json({ ok: false, wired: true, error: 'unavailable' })
  }
})

module.exports = router
