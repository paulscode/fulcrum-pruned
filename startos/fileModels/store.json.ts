import { FileHelper, z } from '@start9labs/start-sdk'
import { BackendId, backendIds, defaultBackend } from '../backends'
import { sdk } from '../sdk'

const backendId = z.enum(backendIds as [BackendId, ...BackendId[]])

export const storeJson = FileHelper.json(
  {
    base: sdk.volumes.main,
    subpath: '/store.json',
  },
  z.looseObject({
    /**
     * The node Fulcrum indexes. Read by `dependencies.ts` to decide which optional dependency is
     * required, and by `main.ts` for which node to reach and which database to open.
     * `.catch()` so a hand-edited or stale value repairs to a resolvable node.
     */
    backend: backendId.catch(defaultBackend),
    /**
     * The nodes whose index has finished building and been announced. Per node, because each
     * node has its own database (`/data/db/<node id>`): a first switch to another node builds a
     * new index, and that one deserves its own "Sync Complete".
     */
    synced: z.array(backendId).catch([]),
    /**
     * When an index was last set aside or deleted. Nothing reads the value; writing it makes the
     * Delete Unused Indexes action, which follows this file, re-evaluate whether it has anything
     * to offer.
     */
    indexesChangedAt: z.number().optional().catch(undefined),
  }),
)
