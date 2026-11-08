import { T } from '@start9labs/start-sdk'
import { Dirent } from 'fs'
import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { backends, defaultBackend, isBackendId } from '../backends'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { chainRecordOnVolume, dbDirOnVolume, dbRoot } from '../utils'

const { InputSpec, Value } = sdk

async function sizeOf(path: string): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return (await stat(path).catch(() => null))?.size ?? 0
  }
  let total = 0
  for (const e of entries) {
    const p = join(path, e.name)
    total += e.isDirectory()
      ? await sizeOf(p)
      : ((await stat(p).catch(() => null))?.size ?? 0)
  }
  return total
}

const formatGB = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

/**
 * Every database on the volume except the selected node's: those of nodes indexed before, and
 * any the chain guard set aside (`<node>.wrong-chain-<time>`).
 */
async function unusedIndexes(effects: T.Effects, reactive = false) {
  // Reactive in the action's metadata: the SDK re-evaluates that only when something it read with
  // .const() changes. Read once, it was computed at install (no other indexes yet) and the action
  // stayed disabled for good. Following the whole store re-evaluates it whenever an index can
  // appear or go: a node switch (backend), a chain-guard set-aside or a deletion (synced).
  const store = await (reactive
    ? storeJson.read().const(effects)
    : storeJson.read().once())
  const selected = store?.backend ?? defaultBackend
  const entries = await readdir(sdk.volumes.main.subpath(dbRoot), {
    withFileTypes: true,
  }).catch(() => [] as Dirent[])
  const out: { name: string; label: string }[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name === selected) continue
    const size = formatGB(await sizeOf(dbDirOnVolume(e.name)))
    const label = isBackendId(e.name)
      ? `${backends[e.name].title} (${size})`
      : `${e.name} (${size})`
    out.push({ name: e.name, label })
  }
  return out
}

export const inputSpec = InputSpec.of({
  indexes: Value.dynamicMultiselect(async ({ effects }) => ({
    name: i18n('Indexes to delete'),
    description: i18n(
      'The address indexes of nodes this Fulcrum is not using now, with the disk space each takes. A node indexed before can be selected again later, but its index then has to be built from the start.',
    ),
    default: [],
    values: Object.fromEntries(
      (await unusedIndexes(effects)).map((i) => [i.name, i.label]),
    ) as Record<string, string>,
  })),
})

export const deleteUnusedIndexes = sdk.Action.withInput(
  'delete-unused-indexes',

  async ({ effects }) => ({
    name: i18n('Delete Unused Indexes'),
    description: i18n(
      "Free disk space by deleting the address indexes of nodes Fulcrum is not using now. The selected node's index is never listed.",
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility:
      (await unusedIndexes(effects, true)).length > 0
        ? 'enabled'
        : { disabled: i18n('There are no unused indexes') },
  }),

  inputSpec,

  async () => ({ indexes: [] }),

  async ({ effects, input }) => {
    const selected =
      (await storeJson.read((s) => s.backend).once()) ?? defaultBackend
    const synced = (await storeJson.read((s) => s.synced).once()) ?? []
    for (const name of input.indexes) {
      // Never the selected node's, however the form was submitted; never a path outside db/.
      if (name === selected || name.includes('/') || name.startsWith('.'))
        continue
      await rm(dbDirOnVolume(name), { recursive: true, force: true })
      if (isBackendId(name))
        await rm(chainRecordOnVolume(name), { force: true })
    }
    await storeJson.merge(effects, {
      synced: synced.filter((n) => !input.indexes.includes(n)),
      indexesChangedAt: Date.now(),
    })
  },
)
