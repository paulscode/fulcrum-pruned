<p align="center">
  <img src="icon.png" alt="Fulcrum Pruned Logo" width="21%">
</p>

# Fulcrum Pruned on StartOS

Technical reference for this package, for an administering or support agent. End-user docs are in
`instructions.md`.

Fulcrum Pruned is [Fulcrum](https://github.com/cculianu/Fulcrum) 2.1.4, through
[privkeyio's BLAKE2b-aware fork](https://github.com/privkeyio/Fulcrum), with five patches that
let it index and serve a **pruned** node. It serves either chain, SHA256 or BLAKE2b, through
**Select Node**, and installs alongside Electrs Pruned (a different package id), so a server with
two pruned nodes can run an Electrum server for each.

## Identity

| | |
|---|---|
| Package id | `fulcrum-pruned` (never `fulcrum`, the official id, which privkeyio's BLAKE2b package also takes) |
| Version | `2.1.4:0`; StartOS 0.4.0.2 or newer (`osVersion`) |
| start-sdk | 3.1.1 (3.0.4 or newer is required for the LISTEN-only `checkPortListening`) |
| Image | built from the repo-root `Dockerfile`: the `fulcrum` submodule (privkeyio `v2.1.4-blake`, 2146398) plus `patches/`, Debian 13.1, Qt 6 |
| Architectures | x86_64, aarch64 (`emulateMissing: false`) |

## The patches

See `patches/README.md`. In short, against a node whose RPC is fronted by btc-rpc-proxy:

1. `getblock <hash> 0`, not `false`: the proxy serves pruned blocks only for numeric verbosity.
2. `blockchain.transaction.get` passes the block hash from Fulcrum's own index, so no `txindex`
   is needed; an unknown txid gets "not in the index of this server" rather than txindex advice.
3. The startup check asks for tx #1 by block hash and names the proxy if that fails.
4. `server.features.blake2b_fork = {height, hash, header_bytes: 164, block_hash: "blake2b"}` on a
   chain with extended headers; absent otherwise. Same shape as Electrs Pruned.
5. A reply with no `content-type` is accepted (the proxy omits it on the replies it builds).

## Nodes (Select Node)

`startos/backends.ts`. Exactly one is required at a time; each is an optional dependency enabled
only while selected (`dependencies.ts`).

| id | title | RPC | health checks required | version floor |
|---|---|---|---|---|
| `bitcoind` | Bitcoin Knots | `rpc`:8332 | `bitcoind`, `sync-progress` | Start9's Fulcrum range (proxy v0.8.1+ builds) plus `>=#knots:29.4.2:4` (Retropex BLAKE2b, unpruned only) |
| `knots-prerdts` | Bitcoin Knots (SHA256) Companion | `rpc`:8332 | `bitcoind`, `sync-progress` | `>=#knotsprerdts:29.3:29` |
| `knots-blake2b` | Bitcoin Knots (BLAKE2b) Companion | `rpc`:18443 | `node`, `chain` | `>=29.4.3:1` (proxy advertising NODE_BLAKE2B) |

When a node prunes, its `rpc` host is served by its btc-rpc-proxy, which fetches discarded blocks
from peers. The node package runs the proxy; this one never configures it. There is **no
autoconfig task**: no prune, txindex or ZeroMQ requirement. ZeroMQ is used if the node has it on
(found with `getzmqnotifications`); otherwise Fulcrum polls every 2 s.

On a fresh install, `init/chooseBackend.ts` selects the only installed supported node, or raises a
critical Select Node task when there are several or none.

The node's RPC address is resolved over the LXC bridge each start (`getBridgeAddress(...).const()`).
Its `main` volume is mounted read-only at `/mnt/bitcoind` for the cookie
(`/mnt/bitcoind/.cookie` on mainnet, `/mnt/bitcoind/<chain>/.cookie` otherwise). Fulcrum re-reads
the cookie on every request; the daemon waits up to 5 minutes for it before starting Fulcrum.

## Volume layout (`main`, mounted at `/data`)

| path | what |
|---|---|
| `fulcrum.conf` | Fulcrum's config (file model `fileModels/fulcrum.conf.ts`) |
| `banner.txt` | optional server banner (Configure) |
| `store.json` | `backend` (selected node), `synced` (nodes whose index has completed) |
| `db/<node id>/` | that node's Fulcrum datadir (`fulc2_db`, `latch`); about 190 GB on mainnet |
| `db/<node id>.chain.json` | the node's block hash at 961640 when the index was made (chain guard) |
| `db/<node id>.wrong-chain-<time>/` | an index set aside by the chain guard |
| `reindex.request` | marker left by Reindex, consumed at the next start |

### fulcrum.conf

Owned by the package: `datadir` (`/data/db/<node id>`), `bitcoind` (bridge address), `rpccookie`,
`tcp = 0.0.0.0:50001`, `peering = false`, `announce = false`, `banner`. Exposed in Configure:
`bitcoind_timeout` (seeded 120 s at install; Fulcrum's default is 30), `bitcoind_clients`,
`worker_threads`, `db_mem` (seeded at install, lowered after a node's first complete index unless
the user set it), `db_max_open_files`, `max_history`. `max_reorg` is left at Fulcrum's default.

## One index per node, and the chain guard

Fulcrum cannot rewind across the SHA256/BLAKE2b split (blocks from 961640 differ, ~15,000 deep,
far past its 100-block undo depth; it exits fatally). So each node has its own database, and
nothing is shared or trimmed. Switching back to a node indexed before is immediate; a new node is
a full index.

Because the `bitcoind` id can hold either chain, `chainGuard.ts` runs before each Fulcrum start
(mainnet only): it records the node's hash at 961640 next to the database, and if a later node
disagrees, renames the database to `<node id>.wrong-chain-<time>`, notifies, and lets Fulcrum
build a new one.

## Interfaces

Host `main`, interface `main` ("Electrum (SSL)"), container port 50001, SSL terminated by StartOS.
Preferred external ports **50012 (SSL)** and **50011 (TCP)**, deliberately not the 50002/50001
Electrs Pruned and the official Fulcrum prefer. The plain TCP port is reachable only over the LXC
bridge. `startos/utils.ts` exports `mainHostId = 'main'` and `electrumPort = 50001` for dependents
(the Frigate companions); keep them stable.

## Actions

- **Configure**: banner and the performance settings above.
- **Select Node** (`select-backend`): writes `store.json` `backend`; main opens that node's database.
- **Delete Unused Indexes** (`delete-unused-indexes`): every `db/` directory except the selected
  node's, with sizes; deletes the chosen ones. Disabled when there are none.
- **Reindex**: deletes the selected node's database (and chain record) on the next start.

## Health checks

- `primary` ("Electrum (SSL)"): success when Fulcrum has a socket in LISTEN on 50001 (the SDK's
  `checkPortListening`, LISTEN-only since start-sdk 3.0.4). Fulcrum opens the port only once its
  index has caught up, so during a build this reads loading. "Waiting for <node> to start" while
  the node's cookie is absent.
- `sync-progress`: success when listening; otherwise the indexed height out of the node's height
  and a percentage, parsed from Fulcrum's log; "Waiting for Bitcoin to provide historical blocks"
  when the node itself is missing them.
- `synced-true` (oneshot): the per-node "Sync Complete" notification and the `db_mem` drop.

The ids `primary` and `sync-progress` match the official Fulcrum package; dependents gate on them.

## Backups

The volume minus `/db`. A restore rebuilds every index; `main` resets a node's "synced" state when
its database is missing.

## Limits and differences from the official package

- No txindex, no prune requirement, no ZeroMQ requirement.
- About 190 GB per node indexed; Delete Unused Indexes reclaims it.
- A first index against an already-pruned node takes a day or more (several days over Tor):
  every block below the prune point is fetched from peers through the proxy.
- On the BLAKE2b chain, headers from 961640 are 164 bytes and served as such; only BLAKE2b-aware
  wallets can follow that chain.
- Unofficial and not audited, as is the fork it builds on.
