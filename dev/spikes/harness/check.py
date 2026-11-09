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
    def __init__(self):
        self.s = socket.create_connection(('127.0.0.1', PORT), timeout=180)
        self.f = self.s.makefile('r'); self.n = 0
    def call(self, method, *params):
        self.n += 1
        self.s.sendall((json.dumps({'jsonrpc': '2.0', 'id': self.n, 'method': method, 'params': list(params)}) + '\n').encode())
        return json.loads(self.f.readline())

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

c = Client()
print(c.call('server.version', 'check.py', '1.4'))
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
fc = Client()
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

print('\nFAILED: ' + '; '.join(fails) if fails else '\nall checks passed')
sys.exit(1 if fails else 0)
