import {
  rpcHostId as btcRpcHostId,
  rpcPort as btcRpcPort,
} from 'bitcoin-core-startos/startos/utils'
import {
  rpcHostId as b2bRpcHostId,
  rpcPort as b2bRpcPort,
} from 'knots-blake2b-startos/startos/utils'
import { i18n } from './i18n'

/**
 * The Bitcoin nodes Fulcrum Pruned can index, one at a time, chosen with Select Node.
 *
 * The same three Electrs Pruned offers (its `backends.ts` is the model), so a server can run
 * Electrs Pruned on one pruned node and Fulcrum Pruned on the other.
 *
 * Fulcrum talks to a node over RPC only, never p2p, so unlike Electrs Pruned there is no
 * `peer-local` endpoint here. When a node prunes, its RPC host is served by btc-rpc-proxy,
 * which fetches the blocks the node has discarded from its peers; the node package starts the
 * proxy, not this one.
 */
type Endpoints = {
  rpcHostId: string
  rpcPort: number
}

/**
 * The health checks a node must be passing before Fulcrum indexes it.
 *
 * Per node, because the ids are not shared, and StartOS treats an id a package does not
 * declare exactly like a failing one: "Required health check not passing", forever, with no
 * name to show. The official package and the SHA256 Companion run a daemon `bitcoind` with a
 * `sync-progress` check; knots-blake2b is a separate lineage with a daemon `node` and a `chain`
 * check, which fails while the node is not on the BLAKE2b chain.
 */
type BackendHealthChecks = readonly string[]

/** Written out, not imported: a health check id is not exported by the packages that declare it. */
const officialHealthChecks: BackendHealthChecks = ['bitcoind', 'sync-progress']

/** The official package and the SHA256 Companion share these; imported so a change upstream is a type error. */
const officialEndpoints: Endpoints = {
  rpcHostId: btcRpcHostId,
  rpcPort: btcRpcPort,
}

export const backends = {
  bitcoind: {
    // "Bitcoin Knots" rather than "Bitcoin": both flavors share the `bitcoind` id, and nearly
    // everyone running this stack runs Knots. The blurb covers Core.
    title: 'Bitcoin Knots',
    blurb: i18n(
      'The official Bitcoin service, whichever flavor is installed: Knots, Core, or a BLAKE2b build sideloaded over either. A pruned BLAKE2b build that does not run a BLAKE2b-capable btc-rpc-proxy is not supported; run it unpruned.',
    ),
    endpoints: officialEndpoints,
    healthChecks: officialHealthChecks,
  },
  // The id stays `knots-prerdts`; only its title changed when the package renamed itself to SHA256.
  'knots-prerdts': {
    title: 'Bitcoin Knots (SHA256) Companion',
    blurb: i18n(
      'A second node on the same chain as your main Bitcoin service, installed alongside it. It never enforces BIP-110, so if the network splits over that rule this one follows the side that does not require it.',
    ),
    endpoints: officialEndpoints,
    healthChecks: officialHealthChecks,
  },
  'knots-blake2b': {
    title: 'Bitcoin Knots (BLAKE2b) Companion',
    blurb: i18n(
      'A node on the BLAKE2b chain, whose blocks use a different proof of work and a longer header.',
    ),
    endpoints: { rpcHostId: b2bRpcHostId, rpcPort: b2bRpcPort },
    healthChecks: ['node', 'chain'] satisfies BackendHealthChecks,
  },
} as const

export type BackendId = keyof typeof backends

export const backendIds = Object.keys(backends) as BackendId[]

export const defaultBackend: BackendId = 'bitcoind'

/** Labels for the Select Node form, keyed as the SDK's `select` expects. */
export const backendLabels = Object.fromEntries(
  backendIds.map((id) => [id, backends[id].title]),
) as Record<BackendId, string>

export function isBackendId(v: unknown): v is BackendId {
  return typeof v === 'string' && (backendIds as string[]).includes(v)
}

/**
 * Version floors per node. Set by the proxy each release ships, not (as in Electrs Pruned) by
 * the `peer-local` host: on a pruned node every block below the prune height and every
 * transaction lookup goes through btc-rpc-proxy, and Fulcrum needs a proxy that can serve both.
 *
 * - `getrawtransaction <txid> <verbose> <blockhash>` is intercepted from proxy v0.8.0, and the
 *   proxy follows a rotated node cookie from v0.8.1. Without the first, wallets cannot look up
 *   a confirmed transaction; without the second, the proxy rejects Fulcrum after the node's first
 *   restart (node 200, proxy 401).
 * - On the BLAKE2b chain the proxy must also advertise NODE_BLAKE2B (`v0.8.2-blake2b.2`): Knots
 *   29.4.3 and later serve nothing past the chain split to a peer that does not.
 *
 * Fulcrum's startup check (patch 0003) still reports an incapable proxy plainly, for anything
 * a range lets through.
 */
export const versionRange: Record<BackendId, string> = {
  // Start9's own Fulcrum range, which is exactly the Start9 builds shipping proxy v0.8.1 or later
  // ("unstall pruned block fetches and follow the rotated cookie", 29.4:16 / 31.1:16), the SHA256
  // Companion when it still took the official id, and Retropex's BLAKE2b Knots, which takes the
  // `bitcoind` id. Retropex's is supported unpruned only: its proxy predates the BLAKE2b fixes.
  // The same range Mempool Pruned uses.
  bitcoind:
    '(>=28.4:29 && <29) || (>=29.4:16 && <30) || (>=30.3:16 && <31) || >=31.1:16 || >=#knotsprerdts:29.3:29 || >=#knots:29.4.2:4',
  // Must name the flavor: the 31.x line declares no `satisfies` list, so an unflavored range
  // would refuse it. 29.3:29 is the first release whose proxy intercepts getrawtransaction with
  // a block hash and follows a rotated cookie.
  'knots-prerdts': '>=#knotsprerdts:29.3:29',
  // The first release whose proxy advertises NODE_BLAKE2B (v0.8.2-blake2b.2). Versions jumped
  // from 1.0.0:41 to 29.4.3:0 when they started following Knots; 29.4.3:1 sorts above both.
  'knots-blake2b': '>=29.4.3:1',
}
