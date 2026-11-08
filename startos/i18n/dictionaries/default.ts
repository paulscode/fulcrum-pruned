export const DEFAULT_LANG = 'en_US'

const dict = {
  'Server Banner': 0,
  'Custom banner text displayed to connecting Electrum clients. Leave empty to use the Fulcrum default banner.': 1,
  'ASCII art welcome! Variables like $SERVER_VERSION are supported.': 2,
  'Bitcoin RPC Timeout (seconds)': 3,
  'How long Fulcrum waits for any one answer from the node. On a pruned node, a block the node has discarded is fetched from the network first, which can take a while, especially over Tor. Raise this if the logs show "bitcoind request timed out" or the index build keeps restarting.': 4,
  Default: 5,
  'Bitcoin RPC Clients': 6,
  "How many requests Fulcrum keeps open to the node while it builds its index. On a pruned node, blocks it has discarded are fetched from the network one by one, slowly, so more requests at once build the index faster. Each also counts against the node's RPC work queue (64 by default), so keep the total (this plus one, times the CPU cores) at or below about 32.": 7,
  'Worker Threads (0 for auto)': 8,
  '0 uses every CPU core, which keeps Fulcrum most responsive. Set a number to cap how much of the CPU Fulcrum can take.': 9,
  'Database Memory (MB)': 10,
  'Upper bound on memory used by the RocksDB cache. Set at install for the index build and lowered automatically once the index is complete. Raise it for faster queries at the cost of RAM.': 11,
  'Database Max Open Files': 12,
  'Raise this if Fulcrum logs complaints about too many open files.': 13,
  'Max Address History': 14,
  'Largest number of transactions Fulcrum will report for a single address. An address busier than this returns an empty or partial history, balance and coin list rather than an error, so a wallet holding one shows the funds as missing. Raise this if an address you use has a very long history; the limit exists to bound the memory and time a single request can cost.': 15,
  Configure: 16,
  'Configure Fulcrum banner and performance settings.': 17,
  Configuration: 18,
  'Indexes to delete': 19,
  'The address indexes of nodes this Fulcrum is not using now, with the disk space each takes. A node indexed before can be selected again later, but its index then has to be built from the start.': 20,
  'Delete Unused Indexes': 21,
  "Free disk space by deleting the address indexes of nodes Fulcrum is not using now. The selected node's index is never listed.": 22,
  'There are no unused indexes': 23,
  Reindex: 24,
  'Delete the address index of the selected node and rebuild it from Bitcoin. Use this only if the index is corrupted: Fulcrum keeps crashing and its logs report a corrupted database, either a "Corruption" error or a message to delete the datadir and resync. If Bitcoin is still syncing, or a restart has not been tried, do that first. Switching node is not a reason to reindex: each node keeps its own index.': 25,
  'Fulcrum and every service that uses it are unavailable for as long as the first index build took: a day or more on a pruned node, several days over Tor, because every block the node has discarded is fetched from the network again. If the logs show input/output errors, check your drive first: a rebuild on a failing drive fails the same way.': 26,
  'Fulcrum is restarting. It deletes its index and rebuilds it from Bitcoin, which can take several days.': 27,
  'Fulcrum deletes its index and rebuilds it from Bitcoin the next time it starts.': 28,
  'Select Node': 29,
  'Which Bitcoin service to index. Choose the one whose chain you want this Electrum server to serve.': 30,
  'Choose which installed Bitcoin service this Electrum server indexes.': 31,
  'Fulcrum keeps a separate address index for each node. Switching back to a node it has indexed before is immediate. A node it has not indexed yet needs a full index of its own: about 190 GB of disk, and a day or more on a pruned node (several days over Tor), during which wallets cannot connect. The previous index is kept; Delete Unused Indexes frees its space.': 32,
  'The official Bitcoin service, whichever flavor is installed: Knots, Core, or a BLAKE2b build sideloaded over either. A pruned BLAKE2b build that does not run a BLAKE2b-capable btc-rpc-proxy is not supported; run it unpruned.': 33,
  'A second node on the same chain as your main Bitcoin service, installed alongside it. It never enforces BIP-110, so if the network splits over that rule this one follows the side that does not require it.': 34,
  'A node on the BLAKE2b chain, whose blocks use a different proof of work and a longer header.': 35,
  'Choose which Bitcoin node Fulcrum should index. It decides which chain your wallets see, so it is not guessed.': 36,
  'Electrum (SSL)': 37,
  'The main interface for accessing Fulcrum via Electrum protocol through SSL': 38,
  'Starting Fulcrum': 39,
  'Waiting for ${node} to start. Fulcrum starts as soon as the node is up; if it is already running and this persists, check the logs.': 40,
  'Index set aside': 41,
  'The address index for ${node} was built on the other side of the SHA256/BLAKE2b split from the node now installed under that name, so it cannot be used. It has been set aside and a new index is being built. Delete Unused Indexes removes the old one and frees its disk space.': 42,
  'The Electrum interface is ready': 43,
  'Converting the block headers to the current format...': 44,
  'Fulcrum opens the Electrum interface once its index has caught up with the node.': 45,
  'Fulcrum is starting': 46,
  'Sync Progress': 47,
  'Fulcrum is synced': 48,
  'Waiting for Bitcoin to provide historical blocks': 49,
  'Fulcrum is catching up: block ${indexed} of ${total} (${percent}%).': 50,
  'Fulcrum is building its address index: ${percent}%, block ${indexed} of ${total}. On a pruned node, blocks it has discarded are fetched from the network one by one, so a first index takes a day or more, and several days over Tor.': 51,
  'Unknown status': 52,
  'Sync Complete': 53,
  'Fulcrum has finished building its address index for ${node}. It is restarting once to apply a lower database memory setting, after which the Electrum server is ready.': 54,
  'Fulcrum has finished building its address index for ${node}. The Electrum server is ready.': 55,
}

/**
 * Plumbing. DO NOT EDIT.
 *
 * Generated by startos/gen-i18n-dict.py from the i18n() calls in this
 * package. Add a string by using it, then re-run that script.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
