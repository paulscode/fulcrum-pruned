import { FileHelper, z } from '@start9labs/start-sdk'
import { totalmem } from 'os'
import { sdk } from '../sdk'

// The post-sync reduction only reclaims db_mem while it still equals this, so a
// value the user chose in Configure stays theirs.
export const defaultDbMem = () =>
  Math.min(Math.floor((totalmem() * 0.25) / (1024 * 1024)), 2048)

export const syncedDbMem = () => Math.min(512, defaultDbMem())

// Seeded at install, well above Fulcrum's 30 s: on a pruned node a block below the prune
// height comes from peers through btc-rpc-proxy, which can take longer than that, over Tor
// especially. A timeout fails the whole download task and restarts it from the database tip.
export const defaultBitcoindTimeout = 120

// The union's transform output is not revalidated, so without the pipe
// Number('abc') succeeds as NaN and is written back into the file.
const iniNumber = z
  .union([z.string().transform(Number), z.number()])
  .pipe(z.number())
  .optional()
  .catch(undefined)

export const shape = z.looseObject({
  // Per node: `/data/db/<node id>`, written by main before Fulcrum starts. See utils.ts.
  datadir: z.string().optional().catch(undefined),
  bitcoind: z.string().optional().catch(undefined),
  rpcuser: z.literal('').catch(''),
  rpcpassword: z.literal('').catch(''),
  // The selected node's cookie, through its volume mounted at /mnt/bitcoind: at the root on
  // mainnet, in a subdirectory named for the chain otherwise. Written by main.
  rpccookie: z.string().catch('/mnt/bitcoind/.cookie'),
  tcp: z.literal('0.0.0.0:50001').catch('0.0.0.0:50001'),
  peering: z.literal(false).catch(false),
  announce: z.literal(false).catch(false),
  bitcoind_timeout: iniNumber,
  bitcoind_clients: iniNumber,
  worker_threads: iniNumber,
  db_mem: iniNumber,
  db_max_open_files: iniNumber,
  max_history: iniNumber,
  banner: z.literal('/data/banner.txt').catch('/data/banner.txt'),
})

export const fulcrumConf = FileHelper.ini(
  {
    base: sdk.volumes.main,
    subpath: 'fulcrum.conf',
  },
  shape,
)
