import { FileHelper, T } from '@start9labs/start-sdk'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { availableParallelism, totalmem } from 'os'
import { StringDecoder } from 'string_decoder'
import { manifest as bitcoinManifest } from 'bitcoin-core-startos/startos/manifest'
import { BackendId, backends, defaultBackend, isBackendId } from './backends'
import { forgetChain, guardChain, stampChain } from './chainGuard'
import {
  defaultDbMem,
  fulcrumConf,
  syncedDbMem,
} from './fileModels/fulcrum.conf'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  dbDirInContainer,
  dbDirOnVolume,
  electrumPort,
  reindexRequest,
} from './utils'

/** Marks a node's index as not built: its "Sync Complete" fires again when it is. */
async function markUnsynced(effects: T.Effects, node: BackendId) {
  const synced = (await storeJson.read((s) => s.synced).once()) ?? []
  if (synced.includes(node))
    await storeJson.merge(effects, { synced: synced.filter((n) => n !== node) })
}

/**
 * Restores the build-time database memory for an index about to be built, if we lowered it after
 * an earlier sync. Only our own value is touched; one the user chose in Configure stays theirs.
 */
async function raiseDbMemForBuild(effects: T.Effects) {
  if ((await storeJson.read((s) => s.dbMemAuto).once()) === false) return
  if (
    (await fulcrumConf.read((c) => c.db_mem).once()) === syncedDbMem() &&
    syncedDbMem() < defaultDbMem()
  ) {
    await fulcrumConf.merge(
      effects,
      { db_mem: defaultDbMem() },
      { allowWriteAfterConst: true },
    )
  }
}

/** Deletes one node's database, so Fulcrum rebuilds it. The other nodes' databases are untouched. */
async function discardIndex(effects: T.Effects, node: BackendId) {
  await rm(dbDirOnVolume(node), { recursive: true, force: true })
  await forgetChain(node)
  await raiseDbMemForBuild(effects)
  await markUnsynced(effects, node)
}

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting Fulcrum'))

  const backend =
    (await storeJson.read((s) => s.backend).const(effects)) ?? defaultBackend
  const node = backends[backend]
  console.info(`Indexing ${node.title} (${backend})`)

  // The marker names the node that was selected when Reindex ran, so a switch before the next
  // start does not turn it on a different node's index. An empty marker means the selected one.
  if (existsSync(reindexRequest)) {
    const named = (
      await readFile(reindexRequest, 'utf8').catch(() => '')
    ).trim()
    const target = isBackendId(named) ? named : backend
    console.warn(
      `Reindex requested. Deleting the ${target} database; Fulcrum builds it again.`,
    )
    await discardIndex(effects, target)
    await rm(reindexRequest, { force: true })
  }
  await mkdir(dbDirOnVolume(backend), { recursive: true })

  // An index recorded as built but no longer on disk (a restore, which never includes indexes,
  // or one deleted by hand) is being built again, and deserves its "Sync Complete" again.
  if (!existsSync(`${dbDirOnVolume(backend)}/fulc2_db`))
    await markUnsynced(effects, backend)

  // A node indexed for the first time (or again) builds with the larger, install-time database
  // memory, which the post-sync step below lowers once that node's index is complete.
  // And the reverse: a node whose index is already built gets the lower value back, even if a
  // build for another node raised it and was switched away from before it finished.
  const synced = (await storeJson.read((s) => s.synced).once()) ?? []
  const dbMem = await fulcrumConf.read((c) => c.db_mem).once()
  const dbMemAuto = (await storeJson.read((s) => s.dbMemAuto).once()) !== false
  if (dbMemAuto && syncedDbMem() < defaultDbMem()) {
    if (!synced.includes(backend) && dbMem === syncedDbMem())
      await fulcrumConf.merge(effects, { db_mem: defaultDbMem() })
    if (synced.includes(backend) && dbMem === defaultDbMem())
      await fulcrumConf.merge(effects, { db_mem: syncedDbMem() })
  }

  // The node's RPC over the LXC bridge. When it prunes, this is its btc-rpc-proxy. The address
  // changes only when the node's binding does, so this .const() restarts Fulcrum on node
  // install/uninstall/port change and never on a node update. Null while the node is absent: the
  // `bitcoind` line is then omitted, its volume is not mounted (a missing dependency's mount would
  // fail the start), Fulcrum waits for a cookie that is not there and the health checks say so,
  // and the .const() heals it all in (one restart) when the node appears.
  const rpc = await sdk.host
    .getBridgeAddress(effects, {
      packageId: backend,
      hostId: node.endpoints.rpcHostId,
      internalPort: node.endpoints.rpcPort,
      ssl: false,
    })
    .const()

  const dataMount = sdk.Mounts.of().mountVolume({
    volumeId: 'main',
    subpath: null,
    mountpoint: '/data',
    readonly: false,
  })
  const container = await sdk.SubContainer.of(
    effects,
    { imageId: 'main' },
    rpc
      ? dataMount.mountDependency<typeof bitcoinManifest>({
          // Any of the three; they share the volume id. The mountpoint is constant so the cookie
          // path only ever changes with the chain.
          dependencyId: backend as 'bitcoind',
          volumeId: 'main',
          subpath: null,
          mountpoint: '/mnt/bitcoind',
          readonly: true,
        })
      : dataMount,
    'primary-sub',
  )
  const rootfs = await container.rootfs

  // Which chain the node is on, from the config it regenerates on every start. Mainnet writes no
  // chain line; every other chain nests its data, cookie included, in a subdirectory named for it
  // (testnet's is `testnet3`). Followed by the derived chain, not the whole file, so a node
  // settings change that leaves the chain alone does not restart Fulcrum.
  const chainDirs = {
    regtest: 'regtest',
    testnet4: 'testnet4',
    testnet: 'testnet3',
    signet: 'signet',
  } as const
  const chain = await FileHelper.string(`${rootfs}/mnt/bitcoind/bitcoin.conf`)
    .read(
      (conf) =>
        (Object.keys(chainDirs) as (keyof typeof chainDirs)[]).find((c) =>
          conf.split('\n').some((l) => l.trim() === `${c}=1`),
        ) ?? null,
      (prev, next) => prev === next,
    )
    .const(effects)
  const cookiePath = chain
    ? `/mnt/bitcoind/${chainDirs[chain]}/.cookie`
    : '/mnt/bitcoind/.cookie'
  const readCookie = () =>
    readFile(`${rootfs}${cookiePath}`, 'utf8').catch(() => null)

  // Values Fulcrum would refuse or that cannot work on this machine, which can arrive by a restore
  // or a disk moved to a smaller server as well as by Configure: more worker threads than cores
  // (Fulcrum exits), or a database cache over half the RAM (killed once it fills).
  const current = await fulcrumConf.read().once()
  const maxDbMem = Math.floor((totalmem() * 0.5) / (1024 * 1024))
  await fulcrumConf.merge(effects, {
    bitcoind: rpc ?? undefined,
    datadir: dbDirInContainer(backend),
    rpccookie: cookiePath,
    ...((current?.worker_threads ?? 0) > availableParallelism() && {
      worker_threads: undefined,
    }),
    ...((current?.db_mem ?? 0) > maxDbMem && { db_mem: maxDbMem }),
  })

  // Consted *after* the merge above, so that write is already part of the captured value.
  // Fulcrum reads fulcrum.conf only at startup, so every later change (a Configure save, the
  // post-sync db_mem drop) restarts the daemon through this const.
  const conf = await fulcrumConf.read().const(effects)

  // Fulcrum re-reads the cookie on every request, so a node restart needs no Fulcrum restart.
  // The node deletes it while stopped, which is how "waiting for the node" is told from a crash.
  const nodeCookiePresent = () =>
    container
      .exec(['bash', '-c', `[ -r ${JSON.stringify(cookiePath)} ]`], {})
      .then((r) => r.exitCode === 0)
      .catch(() => true)
  const waitingForNode = () =>
    i18n(
      'Waiting for ${node} to start. Fulcrum starts as soon as the node is up; if it is already running and this persists, check the logs.',
      { node: node.title },
    )

  const fulcrumListening = async () =>
    (
      await sdk.healthCheck
        .checkPortListening(effects, electrumPort, {
          successMessage: '',
          errorMessage: '',
          // A slow /proc read under heavy I/O is not Fulcrum exiting.
          timeout: 5_000,
        })
        .catch(() => null)
    )?.result === 'success'

  let lastSyncLog: string | null = null
  // From Fulcrum's periodic "Processed height: N, P%" and "Block height T, downloading" lines.
  let progress: { height: number; percent: string } | null = null
  let nodeTip: number | null = null
  let missingBlockAt = 0
  // Survives the respawn, which performs the discard before Fulcrum runs again.
  let unreadableIndex = false
  // Set while the block headers are being converted, the one startup path that keeps the
  // Electrum port shut for a noticeable stretch without any sync progress to report yet.
  let converting = false
  // Clients can put text in the log once Fulcrum listens, and the index checks all run before that.
  let listening = false
  let syncedNow = synced.includes(backend)
  // Fulcrum's last FATAL line, kept across respawns and cleared only by real progress, so a crash
  // loop shows as a failure with its reason instead of "starting" forever.
  let lastFatal: string | null = null
  const noteFatal = (text: string) => {
    const at = text.indexOf('FATAL: ')
    if (at >= 0)
      lastFatal = text
        .slice(at + 'FATAL: '.length)
        .split('\n')[0]
        .trim()
        .slice(0, 300)
  }
  const crashLoop = () =>
    lastFatal
      ? ({
          result: 'failure',
          message: i18n(
            'Fulcrum keeps stopping: ${error} See the logs. If they report a corrupted database, run Reindex.',
            { error: lastFatal },
          ),
        } as const)
      : null

  return sdk.Daemons.of(effects)
    .addDaemon('primary', {
      subcontainer: container,
      exec: {
        // The SDK calls fn on every respawn, so a restarted Fulcrum inherits no partial line or progress.
        // The SDK calls fn with an abort signal, and a stop or restart waits for fn to finish, so
        // anything slow in here (the chain guard waits for the node) must give way to it.
        fn: async (_, signal) => {
          lastSyncLog = null
          progress = null
          missingBlockAt = 0
          converting = false
          listening = false
          if (unreadableIndex) {
            unreadableIndex = false
            // Names the node, so a main restart between here and the rm below cannot turn the
            // marker on whichever node is selected by then.
            await writeFile(reindexRequest, backend)
            await discardIndex(effects, backend)
            syncedNow = false
            await rm(reindexRequest, { force: true })
            await sdk.notification.create(effects, {
              level: 'warning',
              title: i18n('Index rebuilt'),
              message: i18n(
                'Fulcrum could not read the address index for ${node} (written in an incompatible format, or damaged), so it has been deleted and is being built again. If this happens more than once, check the drive.',
                { node: node.title },
              ),
            })
          }
          // Is the index still on the node's chain? See chainGuard.ts. Waits for the node when there
          // is something to check; changes nothing if it never answers.
          if (rpc) {
            const moved = await guardChain(backend, rpc, readCookie, signal)
            if (moved) {
              // Told first: the index is already moved, and nothing below may stop the user
              // hearing why their wallets are waiting for a rebuild.
              syncedNow = false
              await sdk.notification.create(effects, {
                level: 'warning',
                title: i18n('Index set aside'),
                message: i18n(
                  'The address index for ${node} was built on another chain than the node now installed under that name (the other side of the SHA256/BLAKE2b split, or another network), so it cannot be used. It has been set aside and a new index is being built. Delete Unused Indexes removes the old one and frees its disk space.',
                  { node: node.title },
                ),
              })
              await markUnsynced(effects, backend).catch(console.error)
              await storeJson
                .merge(effects, { indexesChangedAt: Date.now() })
                .catch(console.error)
              await raiseDbMemForBuild(effects).catch(console.error)
            }
          }
          if (signal.aborted) return null
          let pending = ''
          const decoder = new StringDecoder('utf8')
          return {
            // Wait for the node's cookie rather than start Fulcrum against a node that is not up.
            command: [
              'bash',
              '-c',
              `for i in $(seq 1 300); do
  [ -r ${JSON.stringify(cookiePath)} ] && break
  [ "$i" = 1 ] && echo "waiting for the node's cookie at ${cookiePath}"
  sleep 1
done
exec Fulcrum --ts-format none /data/fulcrum.conf`,
            ],
            // Fulcrum logs to stdout; stderr carries signal and loader messages, and must be read
            // or a full pipe would block it.
            onStderr: (chunk) => {
              const text = Buffer.isBuffer(chunk)
                ? chunk.toString('utf8')
                : String(chunk)
              console.error(text)
              noteFatal(text)
            },
            onStdout: (chunk) => {
              const lines = (pending + decoder.write(chunk)).split('\n')
              pending = lines.pop() ?? ''
              for (const line of lines) {
                console.log(line)
                noteFatal(line)

                if (
                  line.includes('Service started, listening for connections')
                ) {
                  listening = true
                  lastFatal = null
                }

                // An index written by a build with an incompatible header format: Fulcrum reports it
                // and exits rather than misreading the data. Discard this node's index so the restart
                // rebuilds it, instead of crash-looping with no way out from the UI. Keyed on the
                // message, so a readable index is never touched.
                if (
                  !listening &&
                  !unreadableIndex &&
                  (line.includes('Magic bytes mismatch for DB fulc2_db') ||
                    line.includes('header format stopped partway'))
                ) {
                  unreadableIndex = true
                  console.warn(
                    'Fulcrum cannot read the existing address index, which was written by a build using a different header format. Discarding it; it will be rebuilt from scratch.',
                  )
                }

                if (
                  !listening &&
                  line.includes('block headers to the current format')
                )
                  converting = true
                // Clear on anything that means the conversion is no longer under way.
                if (
                  line.includes('block headers in ') || // finished
                  line.includes('Caught exception:') || // died, including inside the conversion
                  line.includes('<Controller>') // got far enough to start indexing
                ) {
                  converting = false
                }

                if (line.startsWith('<Controller>')) {
                  lastSyncLog = line.slice('<Controller>'.length).trim()
                  const tip = /Block height (\d+), downloading/.exec(line)
                  if (tip) nodeTip = Number(tip[1])
                  const done = /height: (\d+), ([\d.]+)%/.exec(line)
                  if (done)
                    progress = { height: Number(done[1]), percent: done[2] }
                  if (done || /up-to-date/.test(line)) lastFatal = null
                  // A height Fulcrum has indexed from this node, which is what the chain record may
                  // be stamped from (chainGuard.ts). Fire and forget; it retries at the next line.
                  const upToDate = /Block height (\d+), up-to-date/.exec(line)
                  const indexed = done
                    ? Number(done[1])
                    : upToDate
                      ? Number(upToDate[1])
                      : null
                  if (indexed !== null && rpc)
                    readCookie()
                      .then((cookie) =>
                        cookie
                          ? stampChain(backend, rpc, cookie, indexed)
                          : undefined,
                      )
                      .catch(() => {})
                }
                // Bitcoin's answer for a block it has not downloaded yet; Fulcrum retries every 2 s.
                if (
                  line.includes('getblock: error response') &&
                  /Block not available \(not fully downloaded\)|Block not found on disk/.test(
                    line,
                  )
                ) {
                  missingBlockAt = Date.now()
                }
              }
            },
          }
        },
      },
      ready: {
        display: i18n('Electrum (SSL)'),
        fn: async () => {
          if (await fulcrumListening()) {
            return {
              result: 'success',
              message: i18n('The Electrum interface is ready'),
            }
          }
          if (!(await nodeCookiePresent())) {
            return { result: 'starting', message: waitingForNode() }
          }
          const failing = crashLoop()
          if (failing) return failing
          if (converting) {
            return {
              result: 'loading',
              message: i18n(
                'Converting the block headers to the current format...',
              ),
            }
          }
          if (lastSyncLog) {
            return {
              result: 'loading',
              message: i18n(
                'Fulcrum opens the Electrum interface once its index has caught up with the node.',
              ),
            }
          }
          return {
            result: 'starting',
            message: i18n('Fulcrum is starting'),
          }
        },
      },
      requires: [],
    })
    .addHealthCheck('sync-progress', {
      ready: {
        display: i18n('Sync Progress'),
        fn: async () => {
          if (await fulcrumListening()) {
            return { result: 'success', message: i18n('Fulcrum is synced') }
          }

          if (!(await nodeCookiePresent())) {
            return { result: 'loading', message: waitingForNode() }
          }

          const failing = crashLoop()
          if (failing) return failing

          if (Date.now() - missingBlockAt < 30_000)
            return {
              message: i18n('Waiting for Bitcoin to provide historical blocks'),
              result: 'loading',
            }

          if (progress) {
            const params = {
              percent: progress.percent,
              indexed: progress.height.toLocaleString('en-US'),
              total: (nodeTip ?? progress.height).toLocaleString('en-US'),
            }
            return {
              result: 'loading',
              message: syncedNow
                ? i18n(
                    'Fulcrum is catching up: block ${indexed} of ${total} (${percent}%).',
                    params,
                  )
                : i18n(
                    'Fulcrum is building its address index: ${percent}%, block ${indexed} of ${total}. On a pruned node, blocks it has discarded are fetched from the network one by one, so a first index takes several days, and longer over Tor.',
                    params,
                  ),
            }
          }

          return {
            message: lastSyncLog ?? i18n('Fulcrum is starting'),
            result: 'loading',
          }
        },
      },
      requires: [],
    })
    .addOneshot('synced-true', {
      subcontainer: null,
      exec: {
        fn: async () => {
          const already = (await storeJson.read((s) => s.synced).once()) ?? []
          if (already.includes(backend)) {
            syncedNow = true
            return null
          }
          // Only reclaim what we ourselves seeded; a value the user picked in Configure is theirs.
          const lowerDbMem =
            dbMemAuto &&
            conf?.db_mem === defaultDbMem() &&
            syncedDbMem() < defaultDbMem()

          // Recorded first, so a oneshot stopped part way cannot announce twice.
          await storeJson.merge(effects, { synced: [...already, backend] })
          syncedNow = true
          await sdk.notification.create(effects, {
            level: 'success',
            title: i18n('Sync Complete'),
            message: lowerDbMem
              ? i18n(
                  'Fulcrum has finished building its address index for ${node}. It is restarting once to apply a lower database memory setting, after which the Electrum server is ready.',
                  { node: node.title },
                )
              : i18n(
                  'Fulcrum has finished building its address index for ${node}. The Electrum server is ready.',
                  { node: node.title },
                ),
          })

          // Restarts main via the const above. The node is already recorded as synced, so the
          // rerun skips this block rather than looping.
          if (lowerDbMem) {
            await fulcrumConf.merge(
              effects,
              { db_mem: syncedDbMem() },
              { allowWriteAfterConst: true },
            )
          }
          return null
        },
      },
      requires: ['sync-progress'],
    })
})
