import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

// The first release: a new package id, so there is no install base to migrate.
export const v_2_1_4_0 = VersionInfo.of({
  version: '2.1.4:0',
  releaseNotes: {
    en_US: `First release of Fulcrum Pruned: Fulcrum 2.1.4 for a pruned Bitcoin node, on the SHA256 or the BLAKE2b chain.

- Works against a pruned node. Blocks the node has discarded are fetched from the network by the node's btc-rpc-proxy, both while Fulcrum builds its index and when a wallet looks up an old transaction. No txindex, and no prune setting is changed.
- Select Node chooses which node to index: Bitcoin Knots, Bitcoin Knots (SHA256) Companion, or Bitcoin Knots (BLAKE2b) Companion. Each node keeps its own index, so switching back is immediate. Delete Unused Indexes frees the space of the others.
- Built on privkeyio's BLAKE2b-aware Fulcrum, with five small patches for pruned nodes. server.features reports which side of the BLAKE2b fork the server follows.
- Installs alongside Electrs Pruned, with different preferred ports.

A first index against an already-pruned node takes several days, longer over Tor, and needs about 190 GB of disk.`,
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
