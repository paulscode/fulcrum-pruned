<p align="center">
  <img src="icon.png" alt="Fulcrum Pruned Logo" width="21%">
</p>

# Fulcrum Pruned on StartOS

> Everything not listed in this document should behave the same as upstream
> Fulcrum. If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable — see the Documentation section of
> `instructions.md` for links.

Fulcrum Pruned is [Fulcrum](https://github.com/cculianu/Fulcrum), a fast Electrum server, through
[privkeyio's BLAKE2b-aware fork](https://github.com/privkeyio/Fulcrum), with seven patches that let
it index and serve a **pruned** Bitcoin node through the node's btc-rpc-proxy. It follows either
chain, SHA256 or BLAKE2b, through Select Node, and installs alongside Electrs Pruned (a different
package id), so a server with two pruned nodes can run an Electrum server for each.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

The image is built from this repository's `Dockerfile`: the `fulcrum` submodule (a pinned tag of
privkeyio/Fulcrum) with `patches/` applied at `--fuzz=0`, on Debian with Qt 6. It is built for
x86_64 and aarch64 and never offered under emulation. The binary reports its commit as
`<commit>+pruned`.

| Patch | What it changes |
|---|---|
| 0001 | A bitcoind reply with no `content-type` is accepted: btc-rpc-proxy omits it on the pruned blocks and transactions it builds itself. |
| 0002 | Records whether the node takes a numeric `getblock` verbosity and a block hash in `getrawtransaction` (Core and Knots do); 0003-0005 use those forms only then, and any other node is asked as upstream asks. |
| 0003 | Blocks are requested with `getblock <hash> 0`; the proxy serves a pruned block only for a numeric verbosity. |
| 0004 | `blockchain.transaction.get` names the block, found in Fulcrum's own index, so no `txindex` is needed; counted against the client's throttle as it is read; given `bitcoind_timeout`; the reply must be the transaction asked for; a txid not in the index gets "not in the index of this server" instead of the node's txindex advice. |
| 0005 | The startup check asks for transaction #1 by its block and, on failure, names the proxy; it stops after three failures. |
| 0006 | `server.features.blake2b_fork = {height, hash, header_bytes: 164, block_hash: "blake2b"}` on a chain with extended headers, absent otherwise (the shape Electrs Pruned uses). |
| 0007 | Electrum protocol 1.8 is offered beside 1.4 to 1.6, on both chains (no 1.7); `protocol_max` is 1.8; at 1.8 `blockchain.block.headers` answers with the concatenated hex string, as Electrs Pruned does. Peering keeps 1.6. |

One subcontainer, `primary-sub`, runs the daemon `primary`: a short shell loop that waits up to five
minutes for the node's RPC cookie, then `Fulcrum --ts-format none /data/fulcrum.conf`.

## Volume and Data Layout

One volume, `main`, mounted at `/data`; the selected node's volume is mounted read-only at
`/mnt/bitcoind` (for its cookie and its `bitcoin.conf`) while that node is installed.

| Path | What |
|---|---|
| `fulcrum.conf` | Fulcrum's config (see File Models) |
| `banner.txt` | the server banner, if one is set |
| `store.json` | StartOS-side state: the selected node, which nodes' indexes are complete, whether `db_mem` is the package's to adjust |
| `db/<node id>/` | that node's Fulcrum datadir (RocksDB `fulc2_db`), about 190 GB on mainnet |
| `db/<node id>.chain.json` | what that index was built on: the genesis hash, and the block hash at 961640 once the index has passed it |
| `db/<node id>.wrong-chain-<time>/` | an index the chain guard set aside |
| `reindex.request` | a Reindex marker naming its node, consumed at the next start |

Fulcrum cannot rewind an index across the SHA256/BLAKE2b split (the chains differ from block 961640,
far past its undo depth), so each node has its own database and nothing is shared or trimmed.

## File Models

`fulcrum.conf` (INI) is rewritten on every start for the keys the package owns: `datadir`
(`/data/db/<node id>`), `bitcoind` (the node's bridge address), `rpccookie` (its cookie, at the root
on mainnet or in the chain's subdirectory), `tcp = 0.0.0.0:50001`, `peering` and `announce` (both
false), `banner`. A hand edit to these does not survive.

The rest belong to Configure: `bitcoind_timeout`, `bitcoind_clients`, `worker_threads`, `db_mem`,
`db_max_open_files`, `max_history`. At install the package seeds `bitcoind_timeout` (120 s),
`bitcoind_clients` (sized for about 32 block requests in flight: 7 on 4 cores, Fulcrum's own 3 from
8 cores up) and `db_mem` (a quarter of RAM, capped). Clearing a field in Configure returns it to the
package default. Two values are clamped on every start whoever set them: `worker_threads` above the
core count is removed (Fulcrum would exit), and `db_mem` above half the RAM is lowered.

`db_mem` is the package's to adjust until the user sets it: larger while a node's index builds,
smaller once it is complete (one restart). A value entered in Configure is never changed; clearing
the field hands it back (`store.json` `dbMemAuto`).

`banner.txt` is written by Configure and re-read by Fulcrum on every `server.banner`.

## Dependencies

Exactly one Bitcoin node, chosen with Select Node; the other two are optional dependencies that stay
disabled. Its RPC is reached over the bridge (its btc-rpc-proxy when it prunes), and its `main`
volume is mounted read-only at `/mnt/bitcoind`.

| Node | Package | Health checks required |
|---|---|---|
| Bitcoin Knots (Start9's Core or Knots, or Retropex's BLAKE2b Knots unpruned) | `bitcoind` | `bitcoind`, `sync-progress` |
| Bitcoin Knots (SHA256) Companion | `knots-prerdts` | `bitcoind`, `sync-progress` |
| Bitcoin Knots (BLAKE2b) Companion | `knots-blake2b` | `node`, `chain` |

The version floors (in `startos/backends.ts`) admit only node releases whose proxy can serve a pruned
transaction by block hash and follow a rotated cookie, and on the BLAKE2b chain advertise
`NODE_BLAKE2B` to peers. The package raises no task on the node: no `prune: 0`, no `txindex`, no
ZeroMQ. ZeroMQ is used if the node has it on; otherwise Fulcrum polls every two seconds.

## Network Access and Interfaces

One interface, `main` ("Electrum (SSL)"), on host `main`, container port 50001: the Electrum
protocol, TLS terminated by StartOS. It prefers external ports 50012 (SSL) and 50011 (TCP), so a
server running Electrs Pruned (50002/50001) gets different ones; the plain TCP port is reachable only
over the LXC bridge. Fulcrum opens the port only once its index has caught up with the node, so
wallets cannot connect during a first index. Clients may negotiate Electrum protocol 1.4 to 1.6 or 1.8
(patch 0007), on either chain. `startos/utils.ts` exports `mainHostId` and
`electrumPort` for dependents.

## Installation and First-Run Flow

On install the package seeds `fulcrum.conf` (see File Models) and settles the node: with exactly one
supported node installed it selects it; with several, or none, it raises a critical Select Node task
rather than guess, because `bitcoind` is SHA256 on one server and BLAKE2b on another.

The first start of a node builds its index from genesis. Below the node's prune height every block
is fetched from peers through the proxy, so a first index against a long-pruned node takes several
days, longer over Tor; installed while the node is still in its initial sync, Fulcrum takes blocks
before they are pruned. An interrupted index resumes.

## Actions

The OS lists the actions; this is what it cannot say.

- **Configure**: when tuning performance or the banner. Rewrites the Configure-owned keys in
  `fulcrum.conf` and restarts Fulcrum; safe to repeat. Raise `bitcoind_timeout` if wallets report
  "bitcoind request timed out" for old transactions.
- **Select Node**: when the wallet should follow another node or chain. Writes `store.json` and
  restarts Fulcrum on that node's database: immediate for a node indexed before, a full first index
  (~190 GB, days) for a new one. The previous index is kept. Safe to repeat.
- **Delete Unused Indexes**: to reclaim disk. Lists every database except the selected node's
  (including set-aside ones) with its size and deletes those ticked; a deleted node's index must be
  built again if selected later. No restart. Enabled only when there is something to delete.
- **Reindex**: only for a corrupted index (Fulcrum keeps stopping, the logs report a corrupted
  database). Deletes the selected node's database at the next start; unavailable for as long as a
  first index takes. Not for switching nodes.

## Tasks

One: **Select Node**, critical, raised at install when more than one supported node is installed, or
none. It keeps the service stopped until the user chooses; running Select Node clears it, and it does
not return. No task is raised on the node.

## Health Checks

Two checks, both reading Fulcrum's state, not just its port.

- **`primary`** ("Electrum (SSL)"): success when Fulcrum has a socket in LISTEN on 50001. Before that:
  "Waiting for <node> to start" while the node's cookie is absent (the node is stopping or
  restarting; not a fault), "Fulcrum opens the Electrum interface once its index has caught up" while
  indexing, or a **failure** carrying Fulcrum's last `FATAL:` line when it keeps exiting (a value it
  refuses, a corrupted database: see Reindex).
- **`sync-progress`**: success when listening. Otherwise the indexed height out of the node's, with a
  percentage, from Fulcrum's log; "Waiting for Bitcoin to provide historical blocks" when the node
  itself lacks them; the same failure as above in a crash loop.

The ids match the official Fulcrum package; dependents gate on them. A **Sync Complete** notification
is sent once per node when its index first completes; **Index set aside** when the chain guard moves
an index from another chain; **Index rebuilt** when an unreadable index is deleted.

## Backups and Restore

The `main` volume is copied whole except `/db`: every index, chain record and set-aside index is
left out, since each is rebuilt from its node. A restored instance keeps its node selection and
settings and builds the selected node's index again from genesis (days, as a first index). Its Sync
Complete fires again.

## Limitations and Differences

1. No `txindex`, no prune requirement, no ZeroMQ requirement: the node's btc-rpc-proxy supplies what
   a pruned node no longer has.
2. About 190 GB per node indexed; indexes of nodes no longer selected stay until deleted.
3. A first index against an already-pruned node takes several days, longer over Tor.
4. A wallet looking up an old transaction on a pruned node waits for its block to be fetched from
   peers (seconds, up to `bitcoind_timeout`).
5. On the BLAKE2b chain, headers from block 961640 are 164 bytes: only BLAKE2b-aware wallets follow
   it. Such a wallet negotiates protocol 1.8; one asking for 1.4 to 1.6 is still served (Electrs Pruned
   refuses it there), and gets 164-byte headers it may not read.
6. A node replaced under the same id by one on another chain or network: the chain guard sets the
   old index aside and builds a new one, once the new node has reached the block that tells them
   apart (961640, or genesis for another network).
7. Retropex's BLAKE2b Knots under `bitcoind` is supported unpruned only.
8. Peering and announcing to the public Electrum network are off.
9. Unofficial and not audited, as is the fork it builds on.

---

## Quick Reference for AI Consumers

```yaml
package_id: fulcrum-pruned
image: built from ./Dockerfile (fulcrum submodule + patches/)
architectures: [x86_64, aarch64]
subcontainers: [primary-sub]
volumes:
  main: /data
  node volume (read-only): /mnt/bitcoind
file_models:
  - fulcrum.conf
  - banner.txt
  - store.json
startos_managed_env_vars: []
dependencies: [bitcoind, knots-prerdts, knots-blake2b]  # exactly one enabled, by Select Node
interfaces:
  main: { type: api, port: 50001 }
actions:
  - configure
  - select-backend
  - delete-unused-indexes
  - reindex
tasks:
  - { action: select-backend, severity: critical }
health_checks:
  - primary
  - sync-progress
```
