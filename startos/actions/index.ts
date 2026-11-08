import { sdk } from '../sdk'
import { configure } from './configure'
import { deleteUnusedIndexes } from './deleteUnusedIndexes'
import { reindex } from './reindex'
import { selectBackend } from './selectBackend'

export const actions = sdk.Actions.of()
  .addAction(configure)
  .addAction(selectBackend)
  .addAction(deleteUnusedIndexes)
  .addAction(reindex)
