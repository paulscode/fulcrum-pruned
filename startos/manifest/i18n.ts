export const bitcoindDescription = {
  en_US:
    'The Bitcoin node Fulcrum indexes. It may be pruned: blocks it has discarded are fetched from the network.',
}

export const short = {
  en_US:
    'A fast Electrum server for a pruned node, on the SHA256 or the BLAKE2b chain.',
}

export const long = {
  en_US:
    "Fulcrum Pruned is Fulcrum, a fast Electrum server, made to work against a pruned Bitcoin node, on either chain: SHA256 or BLAKE2b. Connect your wallets to your own node without keeping the whole blockchain. Blocks the node has discarded are fetched from the network when Fulcrum needs them, so neither txindex nor an archival node is required. It installs alongside Electrs Pruned, so a server with two pruned nodes can run an Electrum server for each. Its index is about three times the size of Electrs Pruned's (around 190 GB), and a first index against an already-pruned node takes several days, longer over Tor. Built on privkeyio's BLAKE2b-aware fork of Fulcrum; unofficial and not audited.",
}
