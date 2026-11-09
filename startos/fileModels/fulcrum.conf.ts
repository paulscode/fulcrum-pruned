import { FileHelper, z } from '@start9labs/start-sdk'
import { availableParallelism, totalmem } from 'os'
import { sdk } from '../sdk'

// The post-sync reduction only reclaims db_mem while it still equals this, so a
// value the user chose in Configure stays theirs.
export const defaultDbMem = () =>
  Math.min(Math.floor((totalmem() * 0.25) / (1024 * 1024)), 2048)

export const syncedDbMem = () => Math.min(512, defaultDbMem())

// Seeded at install, well above Fulcrum's 30 s. It governs a wallet's lookup of a transaction in
// a block the node has pruned (patch 0003; fetched from peers through btc-rpc-proxy, up to ~40 s
// measured, longer over Tor), the startup check, and catching up one block at a time. The bulk
// index build is not affected: Fulcrum gives multi-block downloads 10 minutes per request.
export const defaultBitcoindTimeout = 120

// Seeded at install. Fulcrum keeps about cores x (bitcoind_clients + 1) block requests in flight
// while it builds its index. Against a pruned node each is a fetch from peers through the proxy,
// slow one at a time but parallel well: measured on a 4-core server (2026-11-08), 16 in flight gave
// 0.7 blocks/s and 32 gave 1.5, with no failures, and 64 no more. So aim for about 32, which is also
// half of bitcoind's default RPC work queue (64). Fulcrum's own default, 3, from 8 cores up.
export const defaultBitcoindClients = () =>
  Math.min(
    8,
    Math.max(3, Math.ceil(32 / Math.max(1, availableParallelism())) - 1),
  )

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
