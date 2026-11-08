import { backendLabels, defaultBackend, isBackendId } from '../backends'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  backend: Value.select({
    name: i18n('Select Node'),
    description: i18n(
      'Which Bitcoin service to index. Choose the one whose chain you want this Electrum server to serve.',
    ),
    values: backendLabels,
    default: defaultBackend,
  }),
})

export const selectBackend = sdk.Action.withInput(
  'select-backend',

  async () => ({
    name: i18n('Select Node'),
    description: i18n(
      'Choose which installed Bitcoin service this Electrum server indexes.',
    ),
    // Each node has its own index (main.ts, utils.ts). Fulcrum cannot rewind an index across the
    // SHA256/BLAKE2b split, so nothing is shared or trimmed: switching to a node indexed before
    // is instant, and a node indexed for the first time is a full build.
    warning: i18n(
      'Fulcrum keeps a separate address index for each node. Switching back to a node it has indexed before is immediate. A node it has not indexed yet needs a full index of its own: about 190 GB of disk, and a day or more on a pruned node (several days over Tor), during which wallets cannot connect. The previous index is kept; Delete Unused Indexes frees its space.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => ({
    backend: (await storeJson.read((s) => s.backend).once()) ?? defaultBackend,
  }),

  // Only the selection is written; main opens that node's database on its next start.
  async ({ effects, input }) => {
    if (!isBackendId(input.backend)) return
    await storeJson.merge(effects, { backend: input.backend })
  },
)
