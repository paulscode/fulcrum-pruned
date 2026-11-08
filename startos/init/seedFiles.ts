import {
  defaultBitcoindTimeout,
  defaultDbMem,
  fulcrumConf,
} from '../fileModels/fulcrum.conf'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'

export const seedFiles = sdk.setupOnInit(async (effects, kind) => {
  await fulcrumConf.merge(
    effects,
    kind === 'install'
      ? { db_mem: defaultDbMem(), bitcoind_timeout: defaultBitcoindTimeout }
      : {},
  )
  await storeJson.merge(effects, {})
})
