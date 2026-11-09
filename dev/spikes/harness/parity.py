#!/usr/bin/env python3
"""Fulcrum Pruned beside Electrs Pruned, on the same regtest node: whatever works with Electrs Pruned
must work with Fulcrum Pruned (internal_docs/PROTOCOL-1.8-PLAN.md section 3.3).

  ./setup.sh up && ./setup.sh fulcrum && ./setup.sh electrs
  python3 -I parity.py [--wait]       Fulcrum on :19120 (PORT), Electrs on :19130 (ELECTRS_PORT)

Checks, on whichever chain the harness is on:
- Version matrix: every server.version request Electrs Pruned accepts, Fulcrum Pruned accepts, with the
  same version where the request reaches 1.8. Allowed: a range topping at 1.5 to 1.7 gets 1.4 from Electrs
  and the highest of 1.5/1.6 in it from Fulcrum (Fulcrum's own behaviour; the client said it reads it),
  and on SHA256 a range reaching 1.8 gets 1.4 from Electrs and 1.8 from Fulcrum. Requests Electrs refuses
  are listed, not judged: Fulcrum serves a superset.
- Replies: both connected with ['1.4', '1.8'], the same requests to each. Values must match where both
  read the same chain (headers, histories, balances, transactions, proofs); for the rest the shape (the
  keys and the types) must match.
- Allowed differences, not compared: the server name in server.version, methods only Fulcrum has
  (get_mempool), a 1.4.x answer to a range Electrs answers with 1.4, server.features beyond the
  keys both have, error text, and fee estimates' values (each asks the node at a different moment).
"""
import hashlib, json, os, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
FULCRUM = int(os.environ.get('PORT', '19120'))
ELECTRS = int(os.environ.get('ELECTRS_PORT', '19130'))
chain = open(os.path.join(HERE, 'chain')).read().strip()
txs = json.load(open(os.path.join(HERE, 'txs.json')))
BIN = os.environ.get('BIN_DIR') or ('/mnt/Black/bitcoin-blake2b-regtest/upstream/bitcoin-knots/build/bin' if chain == 'blake2b'
       else os.path.expanduser('~/bin/knots/bin'))


def acli(*a):
    return subprocess.check_output([BIN + '/bitcoin-cli', '-datadir=' + HERE + '/nodeA', *a], text=True).strip()


class Client:
    def __init__(self, port, pver=None):
        self.s = socket.create_connection(('127.0.0.1', port), timeout=180)
        self.f = self.s.makefile('r'); self.n = 0
        self.version = self.call('server.version', 'parity.py', pver) if pver is not None else None

    def call(self, method, *params):
        self.n += 1
        try:
            self.s.sendall((json.dumps({'jsonrpc': '2.0', 'id': self.n, 'method': method, 'params': list(params)}) + '\n').encode())
            line = self.f.readline()
        except OSError:
            line = ''
        return json.loads(line) if line else {'error': 'disconnected'}


fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)


def agreed(port, pver):
    r = Client(port, pver).version
    return r['result'][1] if 'result' in r else None


if '--wait' in sys.argv:
    tip = int(acli('getblockcount'))
    for port in (FULCRUM, ELECTRS):
        for _ in range(900):
            try:
                c = Client(port, ['1.4', '1.8'])
                if c.call('blockchain.headers.subscribe').get('result', {}).get('height', -1) >= tip: break
            except OSError:
                pass
            time.sleep(1)

# ---- version matrix ----
print(f'== version matrix ({chain})')
V = lambda v: tuple(int(x) for x in v.split('.'))
REQUESTS = ['1.3', '1.4', '1.4.2', '1.5', '1.6', '1.7', '1.8', '1.9',
            ['1.3', '1.4'], ['1.3', '1.4.2'], ['1.4', '1.6'], ['1.4', '1.7'], ['1.3', '1.8'], ['1.4', '1.8'],
            ['1.4', '2.0'], ['1.8', '1.8'], ['1.8', '2.0'], ['1.7', '1.7'], ['1.9', '2.0']]
bad, refused_by_electrs = [], []
for req in REQUESTS:
    e, f = agreed(ELECTRS, req), agreed(FULCRUM, req)
    top = V(req[1]) if isinstance(req, list) else V(req)
    if e is None:
        refused_by_electrs.append(f'{req} -> Fulcrum {f or "refused"}')
        continue
    if f is None:
        ok = False
    elif e == f:
        ok = True
    elif isinstance(req, list) and e == '1.4' and f.startswith('1.4.') and V(f) <= top:
        ok = True  # Fulcrum answers with the client's own 1.4.x: the same protocol
    elif isinstance(req, list) and e == '1.4' and top >= (1, 8) and chain == 'sha256':
        ok = f == '1.8'
    elif isinstance(req, list) and e == '1.4' and (1, 5) <= top < (1, 8):
        ok = f in ('1.5', '1.6') and V(f) <= top
    else:
        ok = False
    print(f'     {str(req):18} Electrs {e:6} Fulcrum {f}')
    if not ok: bad.append(f'{req}: Electrs {e}, Fulcrum {f}')
check(not bad, f'every version Electrs Pruned accepts, Fulcrum Pruned accepts ({"; ".join(bad) or "all"})')
print('     refused by Electrs (not judged): ' + '; '.join(refused_by_electrs))

# ---- replies ----
e, f = Client(ELECTRS, ['1.4', '1.8']), Client(FULCRUM, ['1.4', '1.8'])
print(f"== replies: Electrs at {e.version['result'][1]}, Fulcrum at {f.version['result'][1]}")


def shape(x):
    if isinstance(x, dict): return {k: shape(v) for k, v in sorted(x.items())}
    if isinstance(x, list): return ['list', shape(x[0])] if x else ['list']
    if isinstance(x, bool): return 'bool'
    if isinstance(x, (int, float)): return 'number'
    if x is None: return 'null'
    return type(x).__name__


def shapes_agree(a, b):
    # An empty list agrees with any list (nothing to compare its items with).
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(shapes_agree(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == 1 or len(b) == 1 or shapes_agree(a[1], b[1])
    return a == b


EXTRA = []  # methods only Fulcrum has


def same(label, method, *params, value=True, normalize=None):
    a, b = e.call(method, *params), f.call(method, *params)
    if (a.get('error') or {}).get('code') == -32601 and 'result' in b:
        print(f'     {label}: only Fulcrum has {method} (allowed: extra method)')
        if method not in EXTRA: EXTRA.append(method)
        return
    if 'error' in a or 'error' in b:
        # Both refusing is agreement; error text may differ.
        ok = 'error' in a and 'error' in b
        check(ok, f'{label}: both {"refuse" if ok else "must answer alike"} (Electrs {a.get("error")}, Fulcrum {b.get("error")})')
        return
    ra, rb = a['result'], b['result']
    if normalize: ra, rb = normalize(ra), normalize(rb)
    if value:
        check(ra == rb, f'{label}: same value' + ('' if ra == rb else f'\n       Electrs {json.dumps(ra)[:300]}\n       Fulcrum {json.dumps(rb)[:300]}'))
    else:
        ok = shapes_agree(shape(ra), shape(rb))
        check(ok, f'{label}: same shape' + ('' if ok else f' (Electrs {shape(ra)}, Fulcrum {shape(rb)})'))


tip = int(acli('getblockcount'))
act = int(open(os.path.join(HERE, 'activation')).read()) if chain == 'blake2b' else None
mid = act + 2 if act else 400
same('blockchain.headers.subscribe', 'blockchain.headers.subscribe')
same(f'blockchain.block.header {mid}', 'blockchain.block.header', mid)
same(f'blockchain.block.header 0', 'blockchain.block.header', 0)
lo = act - 3 if act else 400
# 'max' is each server's own page size; the headers themselves must match.
same(f'blockchain.block.headers {lo}+8', 'blockchain.block.headers', lo, 8, normalize=lambda r: {k: v for k, v in r.items() if k != 'max'})
same(f'blockchain.block.headers {lo}+8 (shape, max included)', 'blockchain.block.headers', lo, 8, value=False)
same(f'blockchain.block.headers {tip - 1}+5 (past the tip)', 'blockchain.block.headers', tip - 1, 5,
     normalize=lambda r: {k: v for k, v in r.items() if k != 'max'})

# Scripthashes of outputs in pruned and unpruned blocks.
scripts = []
for t in txs[::5]:
    tx = json.loads(acli('getrawtransaction', t['txid'], 'true', acli('getblockhash', str(t['height']))))
    scripts += [o['scriptPubKey']['hex'] for o in tx['vout']][:1]
hashes = [hashlib.sha256(bytes.fromhex(s)).digest()[::-1].hex() for s in scripts]
hist_sort = lambda r: sorted(r, key=lambda x: (x['height'], x['tx_hash']))
for i, sh in enumerate(hashes):
    same(f'scripthash {i} get_balance', 'blockchain.scripthash.get_balance', sh)
    same(f'scripthash {i} get_history', 'blockchain.scripthash.get_history', sh, normalize=hist_sort)
    same(f'scripthash {i} listunspent', 'blockchain.scripthash.listunspent', sh,
         normalize=lambda r: sorted(r, key=lambda x: (x['height'], x['tx_hash'], x['tx_pos'])))
    same(f'scripthash {i} get_mempool', 'blockchain.scripthash.get_mempool', sh)
same('scripthash with no history', 'blockchain.scripthash.get_history', '00' * 32)

# A mempool transaction to an address both see.
addr = acli('-rpcwallet=w', 'getnewaddress')
mtx = acli('-rpcwallet=w', '-named', 'sendtoaddress', 'address=' + addr, 'amount=0.02')
spk = json.loads(acli('-rpcwallet=w', 'getaddressinfo', addr))['scriptPubKey']
msh = hashlib.sha256(bytes.fromhex(spk)).digest()[::-1].hex()
for _ in range(60):
    if all(c.call('blockchain.scripthash.get_history', msh).get('result') for c in (e, f)): break
    time.sleep(1)
# The unconfirmed entry (height 0, with its fee) through get_history, which both implement.
same('mempool scripthash get_history', 'blockchain.scripthash.get_history', msh, normalize=hist_sort)
same('mempool scripthash get_balance', 'blockchain.scripthash.get_balance', msh)
same('mempool scripthash get_mempool', 'blockchain.scripthash.get_mempool', msh,
     normalize=lambda r: sorted(r, key=lambda x: x['tx_hash']))
same('mempool transaction.get raw', 'blockchain.transaction.get', mtx)

verbose_norm = lambda r: {k: v for k, v in r.items() if k not in ('confirmations', 'in_active_chain')}
for t in (txs[0], txs[len(txs) // 2], txs[-1]):  # pruned, middle, recent
    same(f'transaction.get raw @{t["height"]}', 'blockchain.transaction.get', t['txid'])
    same(f'transaction.get verbose @{t["height"]}', 'blockchain.transaction.get', t['txid'], True, normalize=verbose_norm)
    same(f'transaction.get_merkle @{t["height"]}', 'blockchain.transaction.get_merkle', t['txid'], t['height'])
    blk = json.loads(acli('getblock', acli('getblockhash', str(t['height'])), '1'))
    pos = blk['tx'].index(t['txid'])
    same(f'transaction.id_from_pos @{t["height"]}:{pos}', 'blockchain.transaction.id_from_pos', t['height'], pos)
    same(f'transaction.id_from_pos @{t["height"]}:{pos} merkle', 'blockchain.transaction.id_from_pos', t['height'], pos, True)
same('transaction.get unknown txid', 'blockchain.transaction.get', '11' * 32)

same('blockchain.estimatefee 2', 'blockchain.estimatefee', 2, value=False)
same('blockchain.relayfee', 'blockchain.relayfee', value=False)
same('mempool.get_fee_histogram', 'mempool.get_fee_histogram', value=False)
same('server.ping', 'server.ping')
same('server.banner', 'server.banner', value=False)

fa, fb = e.call('server.features')['result'], f.call('server.features')['result']
common = sorted(set(fa) & set(fb))
check(set(fa) <= set(fb), f"server.features: Fulcrum has every key Electrs has (Electrs only: {sorted(set(fa) - set(fb)) or 'none'})")
for k in ('genesis_hash', 'hash_function', 'blake2b_fork'):
    if k in fa or k in fb:
        check(fa.get(k) == fb.get(k), f'server.features {k}: same ({fa.get(k)} / {fb.get(k)})')
check(shapes_agree(shape({k: fa[k] for k in common}), shape({k: fb[k] for k in common})),
      f'server.features: same shape for the {len(common)} shared keys')
print(f"     protocol: Electrs {fa.get('protocol_min')}..{fa.get('protocol_max')}, Fulcrum {fb.get('protocol_min')}..{fb.get('protocol_max')}")

print('     methods only Fulcrum has (allowed): ' + (', '.join(EXTRA) or 'none'))
print('\nFAILED: ' + '; '.join(x.splitlines()[0] for x in fails) if fails else '\nall parity checks passed')
sys.exit(1 if fails else 0)
