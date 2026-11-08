import { T } from '@start9labs/start-sdk'
import { BackendId, backends, defaultBackend, versionRange } from './backends'
import { storeJson } from './fileModels/store.json'
import { bitcoindDescription } from './manifest/i18n'
import { sdk } from './sdk'

/**
 * Exactly one node is required: the one selected with Select Node.
 *
 * Each node is its own `optional` dependency, enabled only while it is the selected one, so
 * the UI shows a single node and does not nag about the others (Electrs Pruned's pattern).
 *
 * There is deliberately **no autoconfig task.** The official and BLAKE2b Fulcrum packages raise
 * a critical one forcing `prune: 0`, `txindex: true` and ZeroMQ on. This package exists to drop
 * all three: blocks and transactions a pruned node has discarded come through btc-rpc-proxy
 * (patches 0001-0003), `txindex` is never needed (and Knots refuses it with pruning), and
 * Fulcrum finds ZeroMQ by itself when the node has it on, polling every two seconds otherwise.
 * If you find yourself adding a task here, the bug is elsewhere.
 */

const icons: Record<BackendId, string> = {
  bitcoind:
    'https://raw.githubusercontent.com/Start9Labs/bitcoin-core-startos/refs/heads/30.x/dep-icon.svg',
  'knots-prerdts':
    'https://raw.githubusercontent.com/paulscode/knots-prerdts-startos/main/dep-icon.png',
  'knots-blake2b':
    'https://raw.githubusercontent.com/paulscode/knots-blake2b-startos/main/dep-icon.png',
}

const selected = async (effects: T.Effects) =>
  (await storeJson.read((s) => s.backend).const(effects)) ?? defaultBackend

const backend = (id: BackendId) =>
  sdk.Dependency.optional(id, {
    description: bitcoindDescription,
    metadata: { title: backends[id].title, icon: icons[id] },
    kind: 'running',
    versionRange: versionRange[id],
    healthChecks: [...backends[id].healthChecks],
    enabled: async ({ effects }) => (await selected(effects)) === id,
  })

export const dependencies = sdk.Dependencies.of()
  .addDependency(backend('bitcoind'))
  .addDependency(backend('knots-prerdts'))
  .addDependency(backend('knots-blake2b'))
