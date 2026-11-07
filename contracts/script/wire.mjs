// Copies a deployment written by script/Deploy.s.sol into the site config, so nothing is pasted by hand.
//
//   node script/wire.mjs                                   # deployments/11155111.json -> backend/config/care.json
//   node script/wire.mjs <deployment.json> <care.json>     # explicit paths
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const deploymentFile = process.argv[2] ?? path.join(here, '..', 'deployments', '11155111.json')
const configFile = process.argv[3] ?? path.join(here, '..', '..', 'backend', 'config', 'care.json')

const d = JSON.parse(readFileSync(deploymentFile, 'utf8'))
const c = JSON.parse(readFileSync(configFile, 'utf8'))

for (const key of ['token', 'vault', 'hook', 'keeper', 'rescue', 'ballot', 'airdrop']) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(d[key] ?? '')) throw new Error(`deployment is missing ${key}`)
  c.addresses[key] = d[key]
}
c.pool = { fee: Number(d.poolFee), tickSpacing: Number(d.tickSpacing) }
c.deployBlock = Number(d.deployBlock)
writeFileSync(configFile, `${JSON.stringify(c, null, 2)}\n`)

console.log(`wired ${path.relative(process.cwd(), configFile)}`)
for (const key of ['token', 'vault', 'hook', 'burner', 'ballot', 'airdrop', 'keeper', 'rescue']) console.log(`  ${key.padEnd(7)} ${d[key]}`)
console.log(`  from block ${d.deployBlock}, LP NFT #${d.lpTokenId} (owned by 0x…dEaD)`)
