import { sdk } from './sdk'

// Every node's index lives under /db, along with its chain record and any index the chain
// guard set aside. All of it is rebuilt from the node, so none of it is backed up.
export const { createBackup, restoreInit } = sdk.setupBackups(async () =>
  sdk.Backups.ofVolumes('main').setOptions({
    exclude: ['/db'],
  }),
)
