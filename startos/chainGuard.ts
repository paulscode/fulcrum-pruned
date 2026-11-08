import { existsSync } from 'fs'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { BackendId } from './backends'
import { chainRecordOnVolume, dbDirOnVolume } from './utils'

/**
 * The first block after the SHA256/BLAKE2b split on mainnet. The two chains share every block
 * below it, and differ at it.
 */
export const splitHeight = 961640

/**
 * What a node's database was built on, kept beside it as `db/<node>.chain.json`. Each field is
 * recorded only once the index itself proves it (see `stampChain`), never from whichever node
 * happens to be connected.
 */
type ChainRecord = { genesis?: string; hashAtSplit?: string }

const blockHash = /^[0-9a-f]{64}$/

/**
 * One RPC to the node. Rejects on anything but a well-formed answer, so a node that is starting,
 * a proxy error page or an empty reply can never read as a different chain.
 */
async function rpc(
  address: string,
  cookie: string,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000)
  const res = await fetch(`http://${address}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(cookie.trim()).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'chain-guard', method, params }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  const body = (await res.json()) as { result?: unknown; error?: unknown }
  if (body.error) throw new Error(JSON.stringify(body.error))
  if (body.result === undefined || body.result === null)
    throw new Error('no result')
  return body.result
}

/** A block hash from the node, or a rejection. */
async function hashAt(
  address: string,
  cookie: string,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  const hash = await rpc(address, cookie, 'getblockhash', [height], signal)
  if (typeof hash !== 'string' || !blockHash.test(hash))
    throw new Error('not a block hash')
  return hash
}

/** Waits `ms`, or less if `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), {
      once: true,
    })
  })

async function readRecord(node: string): Promise<ChainRecord> {
  try {
    const parsed = JSON.parse(await readFile(chainRecordOnVolume(node), 'utf8'))
    const record: ChainRecord = {}
    if (blockHash.test(parsed?.genesis)) record.genesis = parsed.genesis
    if (blockHash.test(parsed?.hashAtSplit))
      record.hashAtSplit = parsed.hashAtSplit
    return record
  } catch {
    return {}
  }
}

async function writeRecord(node: string, record: ChainRecord) {
  const path = chainRecordOnVolume(node)
  await writeFile(`${path}.tmp`, JSON.stringify(record) + '\n')
  await rename(`${path}.tmp`, path)
}

/** Forgets a node's chain record, for when its database is deleted. */
export const forgetChain = (node: string) =>
  rm(chainRecordOnVolume(node), { force: true })

/**
 * Keeps a node's database on the chain it was built on. Run before each Fulcrum start.
 *
 * The `bitcoind` id is taken by SHA256 and BLAKE2b packages alike, so the node behind one id can
 * change chain under an existing database (Start9's Knots replaced by Retropex's BLAKE2b build,
 * or the reverse), and a node can be moved to another network. Fulcrum cannot follow either: a
 * different network fails its genesis check, and the two mainnet chains differ from block
 * 961640, ~15,000 blocks deep, far past its undo depth. Both are a fatal exit on every start.
 *
 * Judges only what the record proves: a different genesis, or a different block at 961640 once
 * the node has one. A database with no record, or one still below the split, is valid on both
 * chains and is left alone. When the record says the database is on another chain, it is renamed
 * to `<node>.wrong-chain-<time>` (Delete Unused Indexes lists it), and Fulcrum starts a new one.
 *
 * Waits up to five minutes for the node when there is something to judge, since after a reboot
 * the node is usually still starting when this runs. If it never answers, nothing is changed and
 * the check runs again on the next start; a database on the wrong chain makes Fulcrum exit, which
 * is the next start.
 */
export async function guardChain(
  node: BackendId,
  address: string,
  readCookie: () => Promise<string | null>,
  signal: AbortSignal,
): Promise<{ setAside: string } | null> {
  const record = await readRecord(node)
  if (!record.genesis && !record.hashAtSplit) return null
  // A record without an index (deleted by hand) describes nothing.
  if (!existsSync(`${dbDirOnVolume(node)}/fulc2_db`)) {
    await forgetChain(node)
    return null
  }

  // Everything the decision needs, in one go, or nothing. Bounded by the clock (five minutes) and
  // cut short when the service is stopped or restarted, which waits for this to finish.
  let genesis: string | undefined
  let atSplit: string | null = null
  const deadline = Date.now() + 300_000
  while (genesis === undefined && !signal.aborted && Date.now() < deadline) {
    try {
      const cookie = await readCookie()
      if (!cookie) throw new Error('no cookie yet')
      const g = await hashAt(address, cookie, 0, signal)
      const height = Number(
        await rpc(address, cookie, 'getblockcount', [], signal),
      )
      if (!Number.isInteger(height) || height < 0)
        throw new Error('not a height')
      atSplit =
        record.hashAtSplit && height >= splitHeight
          ? await hashAt(address, cookie, splitHeight, signal)
          : null
      genesis = g
    } catch {
      await pause(5_000, signal)
    }
  }
  if (genesis === undefined) {
    if (!signal.aborted)
      console.warn(
        `Could not reach ${node} to check which chain the index is on; checking again on the next start.`,
      )
    return null
  }

  let detail = ''
  if (record.genesis && record.genesis !== genesis)
    detail = `genesis ${record.genesis}, node now ${genesis}`
  else if (record.hashAtSplit && atSplit && atSplit !== record.hashAtSplit)
    detail = `hash at ${String(splitHeight)} ${record.hashAtSplit}, node now ${atSplit}`
  if (!detail) return null

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
  const setAside = `${node}.wrong-chain-${stamp}`
  await rename(dbDirOnVolume(node), dbDirOnVolume(setAside))
  await forgetChain(node)
  console.warn(
    `The database for ${node} was built on another chain than the node now installed under that name (${detail}). Set aside as db/${setAside}; building a new index.`,
  )
  return { setAside }
}

/**
 * Records what a node's database was built on, once Fulcrum has proved it. Called from Fulcrum's
 * log: `indexedHeight` is a height Fulcrum has just indexed, or caught up to, from this node.
 *
 * - genesis: as soon as Fulcrum is indexing at all, since it exits on a genesis mismatch, so an
 *   index that is moving agrees with the node on genesis;
 * - the hash at 961640: once the index itself has passed that block, from the node it indexed
 *   it from. Before then the index is valid on both chains and nothing is recorded.
 *
 * Best effort: a failure leaves the field unrecorded, to be tried again at the next log line.
 */
export async function stampChain(
  node: BackendId,
  address: string,
  cookie: string,
  indexedHeight: number,
): Promise<void> {
  const record = await readRecord(node)
  const wantSplit = indexedHeight >= splitHeight && !record.hashAtSplit
  if (record.genesis && !wantSplit) return
  try {
    if (!record.genesis) record.genesis = await hashAt(address, cookie, 0)
    if (wantSplit)
      record.hashAtSplit = await hashAt(address, cookie, splitHeight)
    await writeRecord(node, record)
  } catch {
    // tried again at the next progress line
  }
}
