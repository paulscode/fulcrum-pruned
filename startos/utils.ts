import { sdk } from './sdk'

// Part of this package's contract with dependents (the Frigate companions, and anything else that
// resolves Fulcrum Pruned over the bridge): keep these names and values stable, and keep this
// file free of heavy imports, since dependents import it.
export const electrumPort = 50001
export const mainHostId = 'main'

/**
 * Left by the Reindex action, consumed by `main`: an empty file at the volume root. `main` removes
 * it only after the selected node's database is gone, so an interrupted delete repeats.
 */
export const reindexRequest = sdk.volumes.main.subpath('reindex.request')

/**
 * One Fulcrum database per node, at `/data/db/<node id>` (Fulcrum's `datadir`). Switching node
 * switches database; switching back finds its index where it was left. Nothing is ever rewound
 * across the SHA256/BLAKE2b split, which Fulcrum cannot do: past its undo depth (100 blocks) a
 * mismatch is fatal. The cost is disk, about 190 GB per node indexed, reclaimed with Delete
 * Unused Indexes.
 */
export const dbRoot = 'db'
/** The database directory for a node, as Fulcrum sees it inside the container. */
export const dbDirInContainer = (node: string) => `/data/${dbRoot}/${node}`
/** The same directory on the package volume, for the JS side. */
export const dbDirOnVolume = (node: string) =>
  sdk.volumes.main.subpath(`${dbRoot}/${node}`)
/** Which chain a node's database follows; see chainGuard.ts. */
export const chainRecordOnVolume = (node: string) =>
  sdk.volumes.main.subpath(`${dbRoot}/${node}.chain.json`)
