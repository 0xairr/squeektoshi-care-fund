// Squeek Genesis airdrop snapshot.
//
//   node scripts/snapshot.mjs [block]
//
// Reads every Squeek at one block and credits its holder: the wallet that holds it, or for a staked
// Squeek the wallet that staked it. A Squeek counts for every Squeek merged into it, 2^(level-1), so
// merging never loses airdrop. Unsold Squeeks (sale custodian) and the protocol reserve are left out.
// Writes ../airdrop/snapshot.json (the full record) and data/airdrop.json (claims the API serves).
import { createPublicClient, http, fallback, parseAbi, parseAbiItem, getAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COLLECTION = '0xc4c7982657f00509548f3a3a41db7fa439a6856b'
const STAKING = '0x50fd1780526c3186a0c037c7622203bc4fb611ca'
const RESERVE = '0xd5dab9f1d15e9d45548078726c54732a5b59eb78' // SqueekNFT protocolRecipient
const COLLECTION_FROM_BLOCK = 12057769n
const AIRDROP_TOTAL = 70_000_000n * 10n ** 18n // 7% of 1,000,000,000 CARE
const ZERO = '0x0000000000000000000000000000000000000000'
const DEAD = '0x000000000000000000000000000000000000dead'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = createPublicClient({
  chain: sepolia,
  transport: fallback([http('https://sepolia.gateway.tenderly.co'), http('https://ethereum-sepolia-rpc.publicnode.com')]),
  batch: { multicall: { batchSize: 1024 * 6 } },
})

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const NFT_ABI = parseAbi(['function level(uint256 tokenId) view returns (uint8)'])
const STAKING_ABI = parseAbi([
  'function depositor(address collection, uint256 tokenId) view returns (address)',
  'function saleCustodian(address collection) view returns (address)',
])

const snapshotBlock = process.argv[2] ? BigInt(process.argv[2]) : (await client.getBlockNumber()) - 12n

// 1. who holds each Squeek, from every Transfer since the collection was deployed
const owner = new Map()
let chunk = 9000n
for (let from = COLLECTION_FROM_BLOCK; from <= snapshotBlock; ) {
  const to = from + chunk - 1n > snapshotBlock ? snapshotBlock : from + chunk - 1n
  let logs
  try {
    logs = await client.getLogs({ address: COLLECTION, event: TRANSFER, fromBlock: from, toBlock: to })
  } catch {
    if (chunk <= 500n) throw new Error(`getLogs keeps failing at ${from}`)
    chunk /= 2n
    continue
  }
  for (const l of logs) {
    const id = l.args.tokenId
    if (l.args.to.toLowerCase() === ZERO) owner.delete(id)
    else owner.set(id, l.args.to.toLowerCase())
  }
  from = to + 1n
}

// 2. levels, and the real holder of each staked Squeek
const ids = [...owner.keys()].sort((a, b) => (a < b ? -1 : 1))
const levels = await client.multicall({
  allowFailure: false,
  blockNumber: snapshotBlock,
  contracts: ids.map((id) => ({ address: COLLECTION, abi: NFT_ABI, functionName: 'level', args: [id] })),
})
const stakedIds = ids.filter((id) => owner.get(id) === STAKING.toLowerCase())
const depositors = await client.multicall({
  allowFailure: false,
  blockNumber: snapshotBlock,
  contracts: stakedIds.map((id) => ({ address: STAKING, abi: STAKING_ABI, functionName: 'depositor', args: [COLLECTION, id] })),
})
stakedIds.forEach((id, i) => owner.set(id, depositors[i].toLowerCase()))
const saleCustodian = (
  await client.readContract({ address: STAKING, abi: STAKING_ABI, functionName: 'saleCustodian', args: [COLLECTION], blockNumber: snapshotBlock })
).toLowerCase()

const excluded = new Set([ZERO, DEAD, saleCustodian, RESERVE, STAKING.toLowerCase()])

// 3. units per wallet: a level-L Squeek stands for 2^(L-1) original Squeeks
const units = new Map()
const counted = { squeeks: 0, excludedSqueeks: 0, byLevel: {} }
ids.forEach((id, i) => {
  const holder = owner.get(id)
  const level = Number(levels[i])
  if (excluded.has(holder) || level < 1) {
    counted.excludedSqueeks += 1
    return
  }
  const u = 2n ** BigInt(level - 1)
  units.set(holder, (units.get(holder) ?? 0n) + u)
  counted.squeeks += 1
  counted.byLevel[level] = (counted.byLevel[level] ?? 0) + 1
})
const totalUnits = [...units.values()].reduce((a, b) => a + b, 0n)
if (totalUnits === 0n) throw new Error('nobody to airdrop to')
const perUnit = AIRDROP_TOTAL / totalUnits

// 4. the Merkle tree: one leaf per wallet, (account, amount)
const entries = [...units.entries()]
  .map(([account, u]) => ({ account: getAddress(account), units: u, amount: u * perUnit }))
  .sort((a, b) => (a.amount === b.amount ? (a.account < b.account ? -1 : 1) : a.amount > b.amount ? -1 : 1))
const tree = StandardMerkleTree.of(entries.map((e) => [e.account, e.amount.toString()]), ['address', 'uint256'])
const allocated = entries.reduce((a, e) => a + e.amount, 0n)

const claims = {}
for (const [i, v] of tree.entries()) claims[v[0]] = { amount: v[1], proof: tree.getProof(i) }

const summary = {
  snapshotBlock: snapshotBlock.toString(),
  root: tree.root,
  airdropTotal: AIRDROP_TOTAL.toString(),
  allocated: allocated.toString(),
  dust: (AIRDROP_TOTAL - allocated).toString(),
  perUnit: perUnit.toString(),
  wallets: entries.length,
  totalUnits: totalUnits.toString(),
  ...counted,
  excluded: { saleCustodian, reserve: RESERVE },
}
mkdirSync(path.join(here, '..', '..', 'airdrop'), { recursive: true })
writeFileSync(
  path.join(here, '..', '..', 'airdrop', 'snapshot.json'),
  `${JSON.stringify({ ...summary, holders: entries.map((e) => ({ ...e, units: e.units.toString(), amount: e.amount.toString() })) }, null, 2)}\n`
)
writeFileSync(path.join(here, '..', 'data', 'airdrop.json'), `${JSON.stringify({ root: tree.root, snapshotBlock: summary.snapshotBlock, claims })}\n`)
console.log(JSON.stringify(summary, null, 2))
