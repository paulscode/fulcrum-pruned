import { existsSync } from 'fs'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { BackendId } from './backends'
import { chainRecordOnVolume, dbDirOnVolume } from './utils'

/**
 * The first block after the SHA256/BLAKE2b split on mainnet. The two chains share every block
 * below it, and differ at it.
 */
export const splitHeight = 961640

type ChainRecord = { hashAtSplit: string | null }

/**
 * Asks the node for its block hash at the split height. `null` if the node is below it (still
 * syncing, or a chain that has not reached it); `undefined` if the node could not be asked,
 * which callers treat as "do nothing now".
 */
async function nodeHashAtSplit(
  rpc: string,
  cookie: string,
): Promise<string | null | undefined> {
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(`http://${rpc}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(cookie.trim()).toString('base64')}`,
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'chain-guard',
        method,
        params,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json()) as { result?: unknown; error?: unknown }
    if (body.error) throw new Error(JSON.stringify(body.error))
    return body.result
  }
  try {
    const height = Number(await call('getblockcount', []))
    if (!Number.isFinite(height)) return undefined
    if (height < splitHeight) return null
    const hash = await call('getblockhash', [splitHeight])
    return typeof hash === 'string' ? hash : undefined
  } catch {
    return undefined
  }
}

async function readRecord(node: BackendId): Promise<ChainRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(chainRecordOnVolume(node), 'utf8'))
    return typeof parsed?.hashAtSplit === 'string' ||
      parsed?.hashAtSplit === null
      ? { hashAtSplit: parsed.hashAtSplit }
      : null
  } catch {
    return null
  }
}

const writeRecord = (node: BackendId, record: ChainRecord) =>
  writeFile(chainRecordOnVolume(node), JSON.stringify(record) + '\n')

/** Forgets a node's chain record, for when its database is deleted. */
export const forgetChain = (node: BackendId) =>
  rm(chainRecordOnVolume(node), { force: true })

/**
 * Keeps a node's database on the chain it was built on.
 *
 * The `bitcoind` id is taken by SHA256 and BLAKE2b packages alike, so the node behind one id can
 * change chain under an existing database (Start9's Knots replaced by Retropex's BLAKE2b build,
 * or the reverse). Fulcrum cannot follow that: the chains differ from block 961640, ~15,000
 * blocks deep, far past its undo depth, so it would exit with a fatal error on every start.
 *
 * Each database therefore records the node's block hash at the split. Before Fulcrum starts:
 * - no record yet, and the node has passed the split: record it (a database still below the
 *   split is on both chains at once, so this cannot be wrong);
 * - a record that disagrees with the node: the database is on the other chain. Rename it to
 *   `<node id>.wrong-chain-<time>` (Delete Unused Indexes lists it) and let Fulcrum start a new
 *   one. Returns true so the caller can notify the user and reset that node's sync state.
 * - the node unreachable, or below the split: change nothing.
 *
 * Mainnet only: the split height means nothing on a test chain.
 */
export async function guardChain(
  node: BackendId,
  rpc: string,
  cookie: string,
): Promise<{ setAside: string } | null> {
  const nodeHash = await nodeHashAtSplit(rpc, cookie)
  if (nodeHash === undefined || nodeHash === null) return null

  const record = await readRecord(node)
  if (!existsSync(dbDirOnVolume(node)) || !record?.hashAtSplit) {
    await writeRecord(node, { hashAtSplit: nodeHash })
    return null
  }
  if (record.hashAtSplit === nodeHash) return null

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
  const setAside = `${node}.wrong-chain-${stamp}`
  await rename(dbDirOnVolume(node), dbDirOnVolume(setAside))
  await writeRecord(node, { hashAtSplit: nodeHash })
  console.warn(
    `The database for ${node} was built on the other side of the SHA256/BLAKE2b split (hash at ${String(splitHeight)} ${record.hashAtSplit}, node now ${nodeHash}). Set aside as db/${setAside}; building a new index.`,
  )
  return { setAside }
}
