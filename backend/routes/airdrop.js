// GET /api/airdrop[?address=0x…] — the Squeek Genesis airdrop: totals and deadline, and for a wallet
// its amount, Merkle proof and whether it has claimed. Proofs come from data/airdrop.json, written by
// scripts/snapshot.mjs; the contract checks them.
const { Router } = require('express')
const path = require('node:path')
const fs = require('node:fs')
const { parseAbi, isAddress, getAddress } = require('viem')
const { client, latestBlock } = require('../lib/chain')
const { config } = require('../lib/config')
const { cached, visitorCached, jsonSafe } = require('../lib/cache')

const AIRDROP_ABI = parseAbi([
  'function claimed(address) view returns (bool)',
  'function deadline() view returns (uint256)',
  'function merkleRoot() view returns (bytes32)',
  'function snapshotBlock() view returns (uint256)',
])
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

let claims = null
function loadClaims() {
  if (claims) return claims
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'airdrop.json'), 'utf8'))
  const byAccount = new Map()
  for (const [account, c] of Object.entries(raw.claims)) byAccount.set(account.toLowerCase(), { account, ...c })
  claims = { root: raw.root, snapshotBlock: raw.snapshotBlock, wallets: byAccount.size, byAccount }
  return claims
}

const router = Router()

router.get('/', async (req, res) => {
  const airdrop = config.addresses.airdrop
  if (!airdrop) return res.json({ ok: true, wired: false })
  try {
    const data = loadClaims()
    const head = await latestBlock()
    const state = await cached(`airdrop:${airdrop}:${head}`, 60_000, async () => {
      const [deadline, root, snapshotBlock, left] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: airdrop, abi: AIRDROP_ABI, functionName: 'deadline' },
          { address: airdrop, abi: AIRDROP_ABI, functionName: 'merkleRoot' },
          { address: airdrop, abi: AIRDROP_ABI, functionName: 'snapshotBlock' },
          { address: config.addresses.token, abi: ERC20_ABI, functionName: 'balanceOf', args: [airdrop] },
        ],
      })
      return { deadline: Number(deadline), root, snapshotBlock: Number(snapshotBlock), unclaimedWei: left.toString() }
    })
    // The file and the contract must describe the same snapshot, or the proofs are useless.
    const matches = state.root.toLowerCase() === data.root.toLowerCase()

    let me = null
    const address = String(req.query.address ?? '')
    if (isAddress(address) && matches) {
      const entry = data.byAccount.get(address.toLowerCase())
      if (!entry) me = { eligible: false }
      else {
        const claimed = await visitorCached(`airdrop:claimed:${entry.account}`, 4000, () =>
          client.readContract({ address: airdrop, abi: AIRDROP_ABI, functionName: 'claimed', args: [getAddress(entry.account)] })
        )
        me = { eligible: true, account: entry.account, amountWei: entry.amount, proof: entry.proof, claimed }
      }
    }
    res.json(jsonSafe({ ok: true, wired: true, airdrop, wallets: data.wallets, matches, ...state, me }))
  } catch {
    res.json({ ok: false, wired: true, error: 'unavailable' })
  }
})

module.exports = router
