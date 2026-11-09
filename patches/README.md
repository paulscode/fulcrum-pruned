# Patches over privkeyio's Fulcrum

Applied in order by the `Dockerfile`, with `patch -p1 --fuzz=0`, over the `fulcrum`
submodule (privkeyio/Fulcrum `v2.1.4-blake`, 2146398). Generated with
`git format-patch v2.1.4-blake..HEAD` from a working branch of that tree; each builds on its
own, in order, and the series passes Fulcrum's unit tests.

Together they let Fulcrum index, and serve wallets from, a **pruned** node whose RPC port is
fronted by btc-rpc-proxy, which fetches the blocks the node has discarded from its peers.
Every StartOS node package that prunes runs that proxy (Start9's bitcoind, Bitcoin Knots
(SHA256) Companion, Bitcoin Knots (BLAKE2b) Companion). None of these patches changes
behaviour against an archival node, and none needs `-txindex`.

| patch | what | why |
|---|---|---|
| 0001 | a bitcoind reply with no `content-type` is accepted | The proxy omits it on the replies it builds itself, which are exactly the pruned blocks and transactions; Fulcrum dropped the connection on each one. First, because nothing after it works through the proxy without it. |
| 0002 | two quirk flags: `getblock` takes a numeric verbosity (Core, Knots, Litecoin 0.15+), `getrawtransaction` takes a block hash (0.16+) | 0003-0005 use the new request forms only where the node is known to take them; any other node is asked exactly as before. Reported in `/stats`. |
| 0003 | `getblock <hash> 0` instead of `getblock <hash> false` | The proxy serves a pruned block only for a numeric verbosity; a boolean falls through to bitcoind, which fails it. |
| 0004 | `blockchain.transaction.get` passes the block hash, from Fulcrum's own index | Without a hash, bitcoind needs `-txindex` for a confirmed transaction, which a pruned node cannot have. With one, it needs only the block, which the proxy fetches (proxy v0.8.0+). A txid not in the index gets "not in the index of this server" instead of the node's advice to enable `-txindex`. The request counts against the client's bitcoind throttle as it is read (as every other bitcoind-backed method does), and is uncounted if the thread pool refuses the lookup; the reply is relayed only if it is the transaction asked for; a lookup that names a block gets `bitcoind_timeout`, not the fixed 15 s. |
| 0005 | the startup check asks for tx #1 by its block hash | Exercises the pruned path at startup and, on failure, names the proxy and its minimum version instead of asking for `-txindex`. Gives up after three failures rather than asking on every block. |
| 0006 | `server.features` carries `blake2b_fork` | Says which side of the BLAKE2b fork the server follows, in the shape Electrs Pruned uses: `{height, hash, header_bytes: 164, block_hash: "blake2b"}`. Absent on a chain with no extended header. Cached against the tip, so an unchanged tip costs no database reads. |

Tested on regtest, SHA256 and BLAKE2b (activation inside the pruned range), with a pruned
node behind btc-rpc-proxy `v0.8.2-blake2b.2`: index from genesis, raw and verbose
`blockchain.transaction.get` for transactions in pruned and unpruned blocks, an unknown
txid, a mempool transaction, a coinbase, verbose fields against the node, `server.features`, the
same against an archival node without `txindex`, 0005's error with the proxy taken away, and a
client pipelining 3,000 lookups (paused at 50 in flight). The harness lives in
this repository at `dev/spikes/harness/`.

0001-0005 are chain-agnostic; on cculianu/Fulcrum they differ only in using `BTC::HashRev`
where 0004 and 0005 use the BLAKE2b-aware `BTC::HeaderHashRev`. 0006 is for the BLAKE2b fork only.
