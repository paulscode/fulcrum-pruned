import { VersionInfo } from '@start9labs/start-sdk'

// Nothing on disk changes in either direction: the patches change only what Fulcrum asks the node and
// answers wallets, and the index format is the same.
export const current = VersionInfo.of({
  version: '2.1.4:1',
  releaseNotes: {
    en_US: `Fulcrum Pruned now also speaks Electrum protocol 1.8, the version Electrs Pruned uses on the BLAKE2b chain, so wallets and services that work with Electrs Pruned work here too. Everything that connected before still connects.

- Protocol 1.8 is offered on both chains, beside 1.4 to 1.6. A wallet that asks for 1.8 gets block headers in the same form Electrs Pruned sends.
- A wallet that sends more lookups than the server can take at once no longer leaves part of its request allowance used up until it reconnects.

The index is kept: no rebuild.`,
  },
  migrations: {
    up: async () => {},
    down: async () => {},
  },
})
