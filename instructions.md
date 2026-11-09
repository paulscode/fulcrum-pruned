# Fulcrum Pruned

**Read "How long the first index takes" and "Disk space" below before relying on it.** Unlike standard Fulcrum it needs neither `txindex` nor an archival node: blocks a pruned node has discarded are fetched from the Bitcoin network through the RPC proxy the node runs whenever pruning is on.

## Documentation

- [Fulcrum README](https://github.com/cculianu/Fulcrum#readme): the upstream server, its configuration options and the Electrum protocol it serves.
- [privkeyio's BLAKE2b fork](https://github.com/privkeyio/Fulcrum#readme): what changes on the BLAKE2b chain (164-byte headers, BLAKE2b block ids).
- [Start9 Bitcoin guides](https://docs.start9.com/bitcoin-guides/): connecting a wallet to your own Electrum server, certificates, SSL and Tor.

## Getting set up

1. Install a Bitcoin node first, if you have none. Pruning may be on or off.
2. If more than one supported node is installed, Fulcrum Pruned asks which one to index (**Select Node**) before it starts. Pick the one whose chain your wallet uses. With only one installed, it is selected for you.
3. Start Fulcrum Pruned. **Sync Progress** shows how far the index has got: a percentage, and the block it has reached out of your node's height.
4. When **Sync Progress** reports **Fulcrum is synced**, point your wallet at the **Electrum (SSL)** interface. Copy the address from the **Interfaces** page; StartOS assigns the port.

Fulcrum opens the Electrum interface only once its index has caught up with the node, so wallets cannot connect during the first index.

## How long the first index takes

It depends on when you install it.

- **Best: before or during your node's own initial sync.** Fulcrum indexes blocks as the node gets them, before pruning discards them.
- **Slowest: onto a node that has been pruned for a long time.** Every block below the prune point is fetched from the network again. Expect **several days**, and **longer if your node is Tor-only**.

It happens once per node. An interrupted index resumes where it left off.

If Fulcrum says it is **waiting for your node to start**, the node is restarting (usually after an update). Fulcrum starts again by itself as soon as the node is back.

## Disk space

A Fulcrum index is about **190 GB**, roughly three times an Electrs index. That is still far less than an archival node (around 900 GB), but it is the heavier of the two pruned indexers. If disk is tight, use Electrs Pruned for your main node and Fulcrum Pruned for a second one.

Fulcrum keeps **one index per node**. Switching nodes keeps the old index, so switching back is immediate, but each node you index costs its own ~190 GB. **Delete Unused Indexes** frees the space of nodes you no longer use.

## Actions

- **Select Node**: which node to index. Choosing a node indexed before is immediate; a new one needs a full index of its own.
- **Delete Unused Indexes**: lists the indexes of nodes not selected now, with their sizes, and deletes the ones you tick.
- **Configure**: server banner and performance settings. The Bitcoin RPC timeout starts at 120 seconds, because a wallet looking up an old transaction waits while its block is fetched from the network. A value you enter is kept; clearing a field returns it to the default.
- **Reindex**: deletes the selected node's index and builds it again. Only for a corrupted index: Fulcrum keeps stopping, and its status shows a database error. Not needed when switching nodes.

## What running against a pruned node costs you

To serve blocks your node no longer stores, the proxy asks Bitcoin peers for them, by block hash. A peer learns which blocks you wanted, never your addresses. During the first index that only says you are syncing. Afterwards, looking up an old transaction or restoring a wallet with old history can fetch that transaction's block on demand, which tells a watching peer that something in that block interests you. If your node runs over Tor, so do these fetches. If that tradeoff is not one you want, use an archival node with the official Fulcrum.

## Which chain

Fulcrum Pruned follows the chain of the node you select. Its `server.features` reply carries a `blake2b_fork` entry on the BLAKE2b chain (absent on SHA256), so a wallet or service can tell which side it is talking to. On the BLAKE2b chain, block headers from block 961,640 are 164 bytes: use a BLAKE2b-aware wallet there, such as the BLAKE2b build of Sparrow.

Fulcrum Pruned speaks Electrum protocol 1.4 to 1.6, and 1.8. Protocol 1.8 is the version for 164-byte headers, and the one Electrs Pruned uses on the BLAKE2b chain, so a wallet or service that works with Electrs Pruned works here too. Wallets that ask for an older version are still served, as before.

If the node behind **Bitcoin Knots** is replaced by one on the other chain, Fulcrum notices, sets the old index aside with a notification, and builds a new one. (An index that has not yet reached the split, block 961,640, is valid on both chains and is kept.)

## Limitations

- Unofficial and not audited, as is the BLAKE2b fork it builds on.
- A Retropex BLAKE2b node under **Bitcoin Knots** must be unpruned: its proxy cannot serve BLAKE2b blocks.
