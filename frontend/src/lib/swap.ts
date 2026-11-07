// Calldata for everything the site asks a wallet to sign. The buy and sell encodings are the ones
// contracts/test/SepoliaFork.t.sol runs through the live Sepolia UniversalRouter.
import { encodeAbiParameters, encodeFunctionData, maxUint160, maxUint256, parseAbi } from 'viem'
import type { PoolKey } from './hooks'

const NATIVE = '0x0000000000000000000000000000000000000000'
const hex = (value: string): `0x${string}` => value as `0x${string}`

const UR_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)'])
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const PERMIT2_ABI = parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)'])
const VAULT_ABI = parseAbi(['function pay() returns (uint256, uint256)'])
const BURNER_ABI = parseAbi(['function burn(uint256 ethIn, uint256 minTokensOut) returns (uint256)'])
const BALLOT_ABI = parseAbi([
  'function vote(uint8 option, uint256 amount)',
  'function withdraw(uint256 round)',
  'function enact(uint256 round)',
])
const AIRDROP_ABI = parseAbi(['function claim(address account, uint256 amount, bytes32[] proof)'])

const V4_SWAP_THEN_SWEEP = '0x1004' // UniversalRouter: V4_SWAP, SWEEP
const V4_SWAP = '0x10'
const SWAP_ACTIONS = '0x060c0f' // v4: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

const SWAP_PARAMS = [
  {
    type: 'tuple',
    components: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'minHopPriceX36', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const

function v4SwapInput(poolKey: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint) {
  const swap = encodeAbiParameters(SWAP_PARAMS, [
    {
      poolKey: {
        currency0: hex(poolKey.currency0),
        currency1: hex(poolKey.currency1),
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: hex(poolKey.hooks),
      },
      zeroForOne,
      amountIn,
      amountOutMinimum: minOut,
      minHopPriceX36: 0n,
      hookData: '0x',
    },
  ])
  const [inC, outC] = zeroForOne ? [poolKey.currency0, poolKey.currency1] : [poolKey.currency1, poolKey.currency0]
  const settleAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [hex(inC), amountIn])
  const takeAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [hex(outC), minOut])
  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [SWAP_ACTIONS, [swap, settleAll, takeAll]])
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 900)

/** ETH in, tokens out. Unspent ETH (there is none on an exact-in swap) is swept back. */
export function buildBuyTx(router: string, poolKey: PoolKey, ethIn: bigint, minTokensOut: bigint, recipient: string) {
  const sweep = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [NATIVE, hex(recipient), 0n]
  )
  const data = encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: [V4_SWAP_THEN_SWEEP, [v4SwapInput(poolKey, true, ethIn, minTokensOut), sweep], deadline()],
  })
  return { to: router, data, value: ethIn }
}

/** Tokens in, ETH out. The router pulls the tokens through Permit2. */
export function buildSellTx(router: string, poolKey: PoolKey, tokensIn: bigint, minEthOut: bigint) {
  const data = encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: [V4_SWAP, [v4SwapInput(poolKey, false, tokensIn, minEthOut)], deadline()],
  })
  return { to: router, data }
}

/** Step 1 of a first sell: let Permit2 move the token. */
export function buildTokenApproveTx(token: string, permit2: string) {
  return { to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [hex(permit2), maxUint256] }) }
}

/** Step 2 of a first sell: let the router use that Permit2 allowance for 30 days. */
export function buildPermit2ApproveTx(permit2: string, token: string, router: string) {
  const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 3600
  return {
    to: permit2,
    data: encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: 'approve',
      args: [hex(token), hex(router), maxUint160, expiration],
    }),
  }
}

export function buildPayTx(vault: string) {
  return { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'pay' }) }
}

/** Let the ballot take the CARE you lock to vote. */
export function buildApproveTx(token: string, spender: string, amount: bigint = maxUint256) {
  return { to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [hex(spender), amount] }) }
}

export function buildVoteTx(ballot: string, option: number, amount: bigint) {
  return { to: ballot, data: encodeFunctionData({ abi: BALLOT_ABI, functionName: 'vote', args: [option, amount] }) }
}

export function buildWithdrawTx(ballot: string, round: number) {
  return { to: ballot, data: encodeFunctionData({ abi: BALLOT_ABI, functionName: 'withdraw', args: [BigInt(round)] }) }
}

export function buildEnactTx(ballot: string, round: number) {
  return { to: ballot, data: encodeFunctionData({ abi: BALLOT_ABI, functionName: 'enact', args: [BigInt(round)] }) }
}

export function buildClaimTx(airdrop: string, account: string, amount: bigint, proof: string[]) {
  return {
    to: airdrop,
    data: encodeFunctionData({
      abi: AIRDROP_ABI,
      functionName: 'claim',
      args: [hex(account), amount, proof.map((p) => hex(p))],
    }),
  }
}

export function buildBurnTx(burner: string, ethIn: bigint, minTokensOut: bigint) {
  return { to: burner, data: encodeFunctionData({ abi: BURNER_ABI, functionName: 'burn', args: [ethIn, minTokensOut] }) }
}

/** Decimal string with up to 18 places -> wei. Null for anything that is not a positive amount. */
export function parseUnits18(input: string): bigint | null {
  const trimmed = input.trim()
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > 18) return null
  const wei = BigInt(whole || '0') * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18) || '0')
  return wei > 0n ? wei : null
}

/** wei -> a decimal string an input field can hold. */
export function formatUnits18(wei: bigint, maxDecimals = 6): string {
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export function applySlippage(amountOutWei: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100))
  return (amountOutWei * (10_000n - bps)) / 10_000n
}
