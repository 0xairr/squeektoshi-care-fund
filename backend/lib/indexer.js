// Incremental event reader. Each indexer remembers the last block it read and only asks the RPC for
// new blocks on the next sync, so a page poll never turns into a scan of the whole history.
//
// Public RPCs cap the block range of eth_getLogs; on an error the chunk is halved and the sync stops
// early, keeping what it has. The next sync carries on from there.
const { decodeEventLog } = require('viem')
const { client, latestBlock } = require('./chain')

const MAX_CHUNKS_PER_SYNC = 12

// Plain helpers instead of ternaries over BigInt: Vercel's file tracer tries to evaluate ternaries
// statically and crashes on BigInt arithmetic inside them.
function minBig(a, b) {
  if (a < b) return a
  return b
}

function firstBlock(start, head, lookback) {
  if (start !== null) return BigInt(start)
  const back = BigInt(lookback)
  if (head > back) return head - back
  return 0n
}

/**
 * @param {object} o
 * @param {() => string|null} o.address  contract to read (re-evaluated, so config edits apply)
 * @param {Array} o.abi                  event ABI items to decode
 * @param {() => (string|null)[]} [o.topics]  extra topic filter (after topic0)
 * @param {() => number|null} o.fromBlock     first block to read; null = lookback from the head
 * @param {number} [o.lookback]           blocks to read when fromBlock is unknown
 * @param {number} [o.keep]               newest items kept in memory
 */
function createIndexer({ address, abi, topics, fromBlock, lookback = 20_000, keep = 5000 }) {
  let state = { key: null, next: null, items: [] }
  let chunk = 5000n
  let running = null

  async function syncOnce() {
    const addr = address()
    const extra = topics ? topics() : []
    const key = `${addr}:${fromBlock() ?? 'head'}:${extra.join(',')}`
    if (!addr) return []
    if (state.key !== key) state = { key, next: null, items: [] }

    const head = await latestBlock()
    if (state.next === null) state.next = firstBlock(fromBlock(), head, lookback)

    for (let i = 0; i < MAX_CHUNKS_PER_SYNC && state.next <= head; i++) {
      const to = minBig(state.next + chunk - 1n, head)
      let logs
      try {
        logs = await client.request({
          method: 'eth_getLogs',
          params: [
            {
              address: addr,
              fromBlock: `0x${state.next.toString(16)}`,
              toBlock: `0x${to.toString(16)}`,
              ...(extra.length ? { topics: [null, ...extra] } : {}),
            },
          ],
        })
      } catch {
        if (chunk > 100n) chunk /= 2n
        break
      }
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
          state.items.push({
            event: decoded.eventName,
            args: decoded.args,
            blockNumber: Number(BigInt(log.blockNumber)),
            logIndex: Number(BigInt(log.logIndex)),
            txHash: log.transactionHash,
          })
        } catch {
          // not one of ours
        }
      }
      if (state.items.length > keep) state.items = state.items.slice(-keep)
      state.next = to + 1n
    }
    return state.items
  }

  return {
    /** Everything read so far, oldest first. */
    async sync() {
      if (!running) running = syncOnce().finally(() => (running = null))
      return running
    },
    caughtUp: () => state.next !== null,
  }
}

module.exports = { createIndexer }
