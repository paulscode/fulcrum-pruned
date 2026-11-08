import { selectBackend } from '../actions/selectBackend'
import { BackendId, backendIds, backends } from '../backends'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

/**
 * On install, settle which node to index rather than assume one (Electrs Pruned's rule, learned
 * the hard way: a user with both chains' nodes got the SHA256 one without being asked and indexed
 * it for 19 days while their wallet lived on the BLAKE2b chain). Nor can a default be right by id:
 * Retropex's BLAKE2b package takes `bitcoind`, so `bitcoind` is SHA256 on one server and BLAKE2b
 * on another.
 *
 *   - exactly one supported node installed: select it;
 *   - several, or none yet: a critical Select Node task, which keeps the service stopped until
 *     the operator picks one.
 *
 * Install only. An update keeps the choice already made, and a restore brings its own.
 */
export const chooseBackend = sdk.setupOnInit(async (effects, kind) => {
  if (kind !== 'install') return

  const installed: BackendId[] = []
  for (const id of backendIds) {
    const { rpcHostId, rpcPort } = backends[id].endpoints
    // A null bridge means the package is not installed, the same test `main` uses to find
    // a helper node. Read once: this is a decision made at install, not a value to follow.
    const rpc = await sdk.host
      .getBridgeAddress(effects, {
        packageId: id,
        hostId: rpcHostId,
        internalPort: rpcPort,
        ssl: false,
      })
      .once()
      .catch(() => null)
    if (rpc) installed.push(id)
  }

  if (installed.length === 1) {
    await storeJson.merge(effects, { backend: installed[0] })
    return
  }

  await sdk.action.createOwnTask(effects, selectBackend, 'critical', {
    reason: i18n(
      'Choose which Bitcoin node Fulcrum should index. It decides which chain your wallets see, so it is not guessed.',
    ),
  })
})
