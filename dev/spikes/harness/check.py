#!/usr/bin/env python3
"""Checks a Fulcrum Pruned under the regtest harness, one assertion per patch.

  python3 -I check.py [--wait]     reads txs.json, chain, activation from this directory

0001 (no content-type),
0002 (quirk flags),
0003 (getblock 0):        Fulcrum indexed every block, including those only the proxy can supply.
0004 (transaction.get):   every transaction, pruned or not, raw and verbose, comes back; a txid
                          not in the index gets the rewritten message, not txindex advice.
                          A client pipelining 3,000 lookups gets every answer; with
                          FULCRUM_DEBUG=1 at `setup.sh fulcrum`, the log shows the client's reads
                          paused at 50 in flight (count 'PAUSING reads' in `docker logs fulcrum-harness`).
0005 (startup check):     no txindex banner in Fulcrum's log (checked by the caller from the log;
                          FULCRUM_BITCOIND_PORT=19111 skips the proxy to see the banner).
0006 (blake2b_fork):      present with the right height and hash on BLAKE2b, absent on SHA256.
0007 (protocol 1.8):      the version matrix (1.4-1.6 and 1.8, no 1.7); protocol_max 1.8; headers as
                          a hex string at 1.4 and 1.8 and a list at 1.6, the hex walking 80- and
                          164-byte headers by bit 31; a cp_height proof whose root is built from the
                          node's block hashes (BLAKE2b ids past activation). The 0001-0006 checks run
                          twice: connected at '1.4', then at ['1.4', '1.8'] (which gets 1.8).
"""
import json, os, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', '19120'))
chain = open(os.path.join(HERE, 'chain')).read().strip()
act = int(open(os.path.join(HERE, 'activation')).read()) if chain == 'blake2b' else None
txs = json.load(open(os.path.join(HERE, 'txs.json')))
# The same node binaries setup.sh used; BIN_DIR overrides, as it does there.
BIN = os.environ.get('BIN_DIR') or ('/mnt/Black/bitcoin-blake2b-regtest/upstream/bitcoin-knots/build/bin' if chain == 'blake2b'
       else os.path.expanduser('~/bin/knots/bin'))

def acli(*a):
    return subprocess.check_output([BIN + '/bitcoin-cli', '-datadir=' + HERE + '/nodeA', *a], text=True).strip()

class Client:
    def __init__(self, pver=None):
        self.s = socket.create_connection(('127.0.0.1', PORT), timeout=180)
        self.f = self.s.makefile('r'); self.n = 0
        if pver is not None:
            self.version = self.call('server.version', 'check.py', pver)
    def call(self, method, *params):
        self.n += 1
        self.s.sendall((json.dumps({'jsonrpc': '2.0', 'id': self.n, 'method': method, 'params': list(params)}) + '\n').encode())
        line = self.f.readline()
        return json.loads(line) if line else {'error': 'disconnected'}

fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)

if '--wait' in sys.argv:
    tip = int(acli('getblockcount'))
    for _ in range(600):
        try:
            c = Client(); c.call('server.version', 'check', '1.4')
            h = c.call('blockchain.headers.subscribe')['result']['height']
            if h >= tip: break
        except OSError:
            pass
        time.sleep(1)

def patches_0001_to_0006(PVER):
    c = Client(PVER)
    print(f'== 0001-0006 connected at {PVER}:', c.version)
    tip = int(acli('getblockcount'))
    sub = c.call('blockchain.headers.subscribe')['result']
    check(sub['height'] == tip, f"0001-0003: indexed to the node's tip {tip} (got {sub['height']})")

    pruned_below = 470
    n_pruned = sum(1 for t in txs if t['height'] < pruned_below)
    print(f"{len(txs)} transactions, {n_pruned} in blocks the pruned node has discarded")
    bad_raw = bad_verbose = 0
    for t in txs:
        raw = c.call('blockchain.transaction.get', t['txid'])
        if 'error' in raw or raw.get('result') != acli('getrawtransaction', t['txid'], 'false', acli('getblockhash', str(t['height']))):
            bad_raw += 1; print('  raw', t, raw.get('error'))
        v = c.call('blockchain.transaction.get', t['txid'], True)
        r = v.get('result') or {}
        if 'error' in v or r.get('txid') != t['txid'] or r.get('confirmations', 0) < 1:
            bad_verbose += 1; print('  verbose', t, v.get('error'))
    check(bad_raw == 0, f"0004: raw transaction.get for all {len(txs)} (wrong: {bad_raw})")
    check(bad_verbose == 0, f"0004: verbose transaction.get for all {len(txs)} (wrong: {bad_verbose})")

    # Verbose fields agree with the node's own answer (asked with the block hash, since the reference
    # node has no txindex either). in_active_chain is added by bitcoind and the proxy alike when a
    # block hash is given, so it is allowed to be present.
    bad_fields = 0
    for t in txs[::7]:
        want = json.loads(acli('getrawtransaction', t['txid'], 'true', acli('getblockhash', str(t['height']))))
        got = c.call('blockchain.transaction.get', t['txid'], True)['result']
        for k in ('txid', 'hash', 'blockhash', 'blocktime', 'hex', 'vin', 'vout'):
            if got.get(k) != want.get(k):
                bad_fields += 1; print('  field', k, t['height'])
    check(bad_fields == 0, f'0004: verbose fields match the node for {len(txs[::7])} transactions')

    # A coinbase in a pruned block, raw.
    cb_h = 50
    cb = json.loads(acli('getblock', acli('getblockhash', str(cb_h)), '1'))['tx'][0]
    got = c.call('blockchain.transaction.get', cb)
    check(got.get('result') == acli('getrawtransaction', cb, 'false', acli('getblockhash', str(cb_h))),
          f'0004: coinbase at height {cb_h} (pruned block)')

    # A mempool transaction: not in the index, so asked without a hash, which the node answers.
    mtx = acli('-rpcwallet=w', '-named', 'sendtoaddress', 'address=' + acli('-rpcwallet=w', 'getnewaddress'), 'amount=0.01')
    for _ in range(30):
        got = c.call('blockchain.transaction.get', mtx)
        if 'result' in got: break
        time.sleep(1)
    check(got.get('result') == acli('getrawtransaction', mtx), 'mempool transaction (no block hash, served from the mempool)')

    # merkle proofs still work for pruned-block transactions (index only, no node involved)
    t0 = txs[0]
    m = c.call('blockchain.transaction.get_merkle', t0['txid'], t0['height'])
    check('result' in m and m['result']['block_height'] == t0['height'], 'get_merkle for a pruned-block transaction')

    missing = c.call('blockchain.transaction.get', '11' * 32)
    msg = json.dumps(missing.get('error'))
    check('error' in missing and 'txindex' not in msg and 'not in the index of this server' in msg,
          f"0004: unknown txid gets the rewritten error ({msg[:140]})")

    # A client pipelining many lookups at once (each a block fetch from peers on a pruned node). Every one
    # must be answered, and correctly; the throttle pauses the client's reads at 50 in flight (see above).
    N = 3000
    fc = Client(PVER)
    payload = ''.join(json.dumps({'jsonrpc': '2.0', 'id': i, 'method': 'blockchain.transaction.get',
                                  'params': [txs[i % len(txs)]['txid']]}) + '\n' for i in range(N))
    fc.s.sendall(payload.encode())
    answers = {}
    for _ in range(N):
        r = json.loads(fc.f.readline()); answers[r['id']] = r
    want = {t['txid']: c.call('blockchain.transaction.get', t['txid'])['result'] for t in txs}
    wrong = sum(1 for i, r in answers.items() if r.get('result') != want[txs[i % len(txs)]['txid']])
    check(len(answers) == N and wrong == 0, f'0004: {N} pipelined lookups from one client all answered correctly (wrong: {wrong})')

    feat = c.call('server.features')['result']
    fork = feat.get('blake2b_fork')
    if chain == 'sha256':
        check(fork is None, '0006: no blake2b_fork on the SHA256 chain')
    else:
        want = acli('getblockhash', str(act))
        check(fork == {'height': act, 'hash': want, 'header_bytes': 164, 'block_hash': 'blake2b'},
              f"0006: blake2b_fork = {fork} (want height {act}, hash {want})")
        hdr = c.call('blockchain.block.header', act + 1)['result']
        check(len(hdr) == 328, f'v2 header served at {act + 1} ({len(hdr) // 2} bytes)')



patches_0001_to_0006('1.4')
patches_0001_to_0006(['1.4', '1.8'])

# ---- 0007: protocol 1.8 ----
print('== 0007')
import hashlib
MATRIX = [  # (what the client sends, the version it should get, or None for refused)
    ('1.3', None), ('1.4', '1.4'), ('1.4.2', '1.4.2'), ('1.5', '1.5'), ('1.6', '1.6'), ('1.7', None),
    ('1.8', '1.8'), ('1.9', None),
    (['1.3', '1.4.2'], '1.4.2'), (['1.4', '1.6'], '1.6'), (['1.4', '1.7'], '1.6'), (['1.3', '1.8'], '1.8'),
    (['1.4', '2.0'], '1.8'), (['1.7', '1.7'], None), (['1.9', '2.0'], None), (['1.8', '1.4'], None),
]
bad = []
for sent, want in MATRIX:
    r = Client(sent).version
    got = r['result'][1] if 'result' in r else None
    if got != want:
        bad.append(f'{sent}: got {got} want {want}')
check(not bad, f'0007: version matrix, {len(MATRIX)} cases ({"; ".join(bad) or "all as expected"})')

feat = Client('1.8').call('server.features')['result']
check(feat.get('protocol_min') == '1.4' and feat.get('protocol_max') == '1.8',
      f"0007: server.features protocol_min {feat.get('protocol_min')}, protocol_max {feat.get('protocol_max')}")
check(('blake2b_fork' in feat) == (chain == 'blake2b'), '0007: blake2b_fork unchanged at 1.8')

def walk(hexstr):
    """Split concatenated header hex by each header's version bit 31 (80 or 164 bytes)."""
    raw, out, i = bytes.fromhex(hexstr), [], 0
    while i < len(raw):
        n = 164 if int.from_bytes(raw[i:i + 4], 'little') & 0x80000000 else 80
        out.append(raw[i:i + n].hex()); i += n
    return out

start = act - 3 if chain == 'blake2b' else 400
COUNT = 8
node_hdrs = [acli('getblockheader', acli('getblockhash', str(h)), 'false') for h in range(start, start + COUNT)]
sizes = sorted({len(h) // 2 for h in node_hdrs})
for pver, form in (('1.4', 'hex'), ('1.6', 'list'), ('1.8', 'hex')):
    r = Client(pver).call('blockchain.block.headers', start, COUNT)['result']
    if form == 'hex':
        ok = isinstance(r.get('hex'), str) and 'headers' not in r and walk(r['hex']) == node_hdrs
    else:
        ok = r.get('headers') == node_hdrs and 'hex' not in r
    check(ok and r.get('count') == COUNT,
          f'0007: blockchain.block.headers {start}..{start + COUNT - 1} at {pver} is a {form}, '
          f'matching the node (header sizes {sizes})')

def sha256d(b): return hashlib.sha256(hashlib.sha256(b).digest()).digest()
cp = int(acli('getblockcount'))
leaves = [bytes.fromhex(acli('getblockhash', str(h)))[::-1] for h in range(cp + 1)]
level = leaves
while len(level) > 1:
    if len(level) % 2: level = level + [level[-1]]
    level = [sha256d(level[k] + level[k + 1]) for k in range(0, len(level), 2)]
want_root = level[0][::-1].hex()
h = act + 2 if chain == 'blake2b' else 400
for pver in ('1.4', '1.8'):
    r = Client(pver).call('blockchain.block.header', h, cp).get('result') or {}
    # fold the block's own id up the branch to the root
    node, idx = leaves[h], h
    for sib in r.get('branch', []):
        sib = bytes.fromhex(sib)[::-1]
        node = sha256d(sib + node) if idx & 1 else sha256d(node + sib)
        idx >>= 1
    check(r.get('root') == want_root and node[::-1].hex() == want_root
          and r.get('header') == acli('getblockheader', acli('getblockhash', str(h)), 'false'),
          f'0007: cp_height proof for {h} to {cp} at {pver}: root from the node\'s block hashes, '
          f'branch folds from the block id ({"BLAKE2b" if chain == "blake2b" else "SHA256"})')

print('\nFAILED: ' + '; '.join(fails) if fails else '\nall checks passed')
sys.exit(1 if fails else 0)
