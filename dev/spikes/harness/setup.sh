#!/usr/bin/env bash
# Regtest harness for Fulcrum Pruned. Modelled on Electrs Pruned's
# (/mnt/Black/pruned-electrs/spikes/harness/setup.sh), on its own ports so the two never collide.
#
#   node A (archival, p2p :19100)  <-- p2p --  node B (pruned, rpc :19111)
#                                                  |
#                                               proxy :19113 --> B's rpc, falls back to peers (= A)
#                                                  |
#                                               Fulcrum (rpc via the proxy, tcp :19120)
#
#   CHAIN=sha256  ./setup.sh up     Knots, SHA256 chain
#   CHAIN=blake2b ./setup.sh up     the BLAKE2b lab build, activation at ACT (default 300)
#   ./setup.sh fulcrum              (re)start Fulcrum against the proxy, fresh datadir
#   FULCRUM_NODE=nodeA FULCRUM_BITCOIND_PORT=19101 ./setup.sh fulcrum   ... against the archival node directly (no txindex)
#   ./setup.sh electrs              (re)start Electrs Pruned beside it on :19130, for parity.py
#   ./setup.sh down | clean
#
# Mines 800 blocks with wallet transactions spread through them, prunes B below 500 (B keeps
# the rest), and writes txs.json: every txid with the height it confirmed at. Blocks 1-499 then
# exist only on A, so Fulcrum indexes them through the proxy, and transactions in them can be
# served only through it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKES="$(cd "$ROOT/.." && pwd)"
CHAIN="${CHAIN:-sha256}"
ACT="${ACT:-300}"
if [ "$CHAIN" = blake2b ]; then
  BIN="${BIN_DIR:-/mnt/Black/bitcoin-blake2b-regtest/upstream/bitcoin-knots/build/bin}"
  # The lab build refuses to start without a headline; the node's own mining satisfies the rule.
  EXTRA=("-testactivationheight=blake2b@$ACT" "-blake2b_headline=BLAKE2b lab 2026-08-21")
else
  BIN="${BIN_DIR:-$HOME/bin/knots/bin}"
  EXTRA=()
fi
PROXY="${PROXY:-/mnt/Black/pruned-electrs/vendor/btc-rpc-proxy/target/release/btc_rpc_proxy}"
A_DIR="$ROOT/nodeA"; A_RPC=19101; A_P2P=19100
B_DIR="$ROOT/nodeB"; B_RPC=19111; B_P2P=19110; B_WHITE=19112  # B_WHITE: noban,download, for Electrs's p2p (parity)
PROXY_PORT=19113; FULCRUM_TCP=19120

acli() { "$BIN/bitcoin-cli" -datadir="$A_DIR" "$@"; }
bcli() { "$BIN/bitcoin-cli" -datadir="$B_DIR" "$@"; }

write_confs() {
  mkdir -p "$A_DIR" "$B_DIR"
  printf 'regtest=1\nserver=1\nlisten=1\nfallbackfee=0.0001\n[regtest]\nrpcport=%s\nport=%s\nbind=127.0.0.1:%s\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\n' \
    $A_RPC $A_P2P $A_P2P > "$A_DIR/bitcoin.conf"
  # prune=1: manual pruning, so nothing goes until pruneblockchain is called.
  printf 'regtest=1\nserver=1\nprune=1\nlisten=1\nfallbackfee=0.0001\n[regtest]\nrpcport=%s\nport=%s\nbind=127.0.0.1:%s\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\nconnect=127.0.0.1:%s\nwhitebind=noban,download@127.0.0.1:%s\n' \
    $B_RPC $B_P2P $B_P2P $A_P2P $B_WHITE > "$B_DIR/bitcoin.conf"
}

start_nodes() {
  "$BIN/bitcoind" -datadir="$A_DIR" "${EXTRA[@]}" -daemon
  # -fastprune: tiny block files, so pruneblockchain has whole files to discard.
  "$BIN/bitcoind" -datadir="$B_DIR" "${EXTRA[@]}" -fastprune -daemon
  for _ in $(seq 30); do
    acli getblockcount >/dev/null 2>&1 && bcli getblockcount >/dev/null 2>&1 && return 0; sleep 1
  done
  echo "nodes failed to come up" >&2; return 1
}

mine_with_txs() {
  acli -named createwallet wallet_name=w >/dev/null 2>&1 || acli loadwallet w >/dev/null 2>&1 || true
  local addr; addr=$(acli getnewaddress)
  [ "$(acli getblockcount)" -ge 800 ] && return 0
  acli generatetoaddress 110 "$addr" >/dev/null
  echo '[' > "$ROOT/txs.json"
  local first=1
  # A few transactions in every 50-block stretch: some below the prune point, some above, and
  # on BLAKE2b some either side of the activation height.
  while [ "$(acli getblockcount)" -lt 790 ]; do
    for _ in 1 2 3; do
      local txid h
      txid=$(acli -named sendtoaddress address="$(acli getnewaddress)" amount=0.1$RANDOM)
      acli generatetoaddress 1 "$addr" >/dev/null
      h=$(acli getblockcount)
      [ $first = 1 ] && first=0 || echo ',' >> "$ROOT/txs.json"
      printf '{"txid":"%s","height":%s}' "$txid" "$h" >> "$ROOT/txs.json"
    done
    acli generatetoaddress 47 "$addr" >/dev/null
  done
  echo ']' >> "$ROOT/txs.json"
  acli generatetoaddress $((800 - $(acli getblockcount))) "$addr" >/dev/null
}

start_proxy() {
  cat > "$ROOT/proxy.toml" <<EOF
bitcoind_address = "127.0.0.1"
bitcoind_port = $B_RPC
bind_address = "127.0.0.1"
bind_port = $PROXY_PORT
cookie_file = "$B_DIR/regtest/.cookie"
default_fetch_blocks = true
max_peer_concurrency = 3
passthrough_rpccookie = "$B_DIR/regtest/.cookie"
EOF
  nohup "$PROXY" --conf "$ROOT/proxy.toml" -vv > "$ROOT/proxy.log" 2>&1 &
  echo $! > "$ROOT/proxy.pid"
  sleep 2
}

start_fulcrum() {
  stop_fulcrum
  [ -n "${KEEP_DB:-}" ] || rm -rf "$ROOT/fulcrum-db"; mkdir -p "$ROOT/fulcrum-db"
  # Paths as seen inside the dev container, which mounts spikes/ at /w (run.sh).
  cat > "$ROOT/fulcrum.conf" <<EOF
datadir = /w/harness/fulcrum-db
bitcoind = 127.0.0.1:${FULCRUM_BITCOIND_PORT:-$PROXY_PORT}
rpccookie = /w/harness/${FULCRUM_NODE:-nodeB}/regtest/.cookie
tcp = 127.0.0.1:$FULCRUM_TCP
peering = false
announce = false
bitcoind_timeout = 120
${FULCRUM_DEBUG:+debug = true}
EOF
  docker rm -f fulcrum-harness >/dev/null 2>&1 || true
  docker run -d --name fulcrum-harness --network host -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$SPIKES:/w" -w /w fulcrum-pruned-dev "./${FULCRUM_BIN:-build/Fulcrum}" /w/harness/fulcrum.conf >/dev/null
  echo "Fulcrum starting; logs: docker logs -f fulcrum-harness"
}
stop_fulcrum() { docker rm -f fulcrum-harness >/dev/null 2>&1 || true; }

# Electrs Pruned beside Fulcrum, on the same node B and proxy, for parity.py (image: electrs/Dockerfile).
# RPC through the proxy as Fulcrum's, P2P to B's whitebind (a pruned node disconnects a peer asking for a
# block over 288 deep unless it has `download`, as on StartOS); Electrum on 127.0.0.1:$ELECTRS_TCP.
ELECTRS_TCP=19130
start_electrs() {
  stop_electrs
  rm -rf "$ROOT/electrs-db"; mkdir -p "$ROOT/electrs-db"
  printf '%s\n' 'network = "regtest"' "daemon_rpc_addr = \"127.0.0.1:$PROXY_PORT\"" \
    "daemon_p2p_addr = \"127.0.0.1:$B_WHITE\"" 'cookie_file = "/h/nodeB/regtest/.cookie"' \
    'db_dir = "/h/electrs-db"' "electrum_rpc_addr = \"127.0.0.1:$ELECTRS_TCP\"" \
    "monitoring_addr = \"127.0.0.1:$((ELECTRS_TCP + 1))\"" 'log_filters = "INFO"' > "$ROOT/electrs.toml"
  docker run -d --name electrs-harness --network host -u "$(id -u):$(id -g)" -v "$ROOT:/h" \
    "${ELECTRS_IMAGE:-fulcrum-parity-electrs}" --conf /h/electrs.toml >/dev/null
  echo "Electrs Pruned starting on :$ELECTRS_TCP; logs: docker logs -f electrs-harness"
}
stop_electrs() { docker rm -f electrs-harness >/dev/null 2>&1 || true; }

stop_all() {
  stop_fulcrum; stop_electrs
  [ -f "$ROOT/proxy.pid" ] && kill "$(cat "$ROOT/proxy.pid")" 2>/dev/null || true
  rm -f "$ROOT/proxy.pid"
  bcli stop 2>/dev/null || true; acli stop 2>/dev/null || true
  sleep 3
}

case "${1:-up}" in
  up)
    write_confs; start_nodes; mine_with_txs
    for _ in $(seq 60); do [ "$(bcli getblockcount)" = "800" ] && break; sleep 1; done
    echo "A=$(acli getblockcount) B=$(bcli getblockcount) chain=$CHAIN"
    bcli pruneblockchain 500 >/dev/null 2>&1 || true
    echo "B pruneheight=$(bcli getblockchaininfo | jq -r .pruneheight)"
    echo "$CHAIN" > "$ROOT/chain"; [ "$CHAIN" = blake2b ] && echo "$ACT" > "$ROOT/activation" || rm -f "$ROOT/activation"
    start_proxy; echo "proxy up on 127.0.0.1:$PROXY_PORT"
    ;;
  fulcrum) start_fulcrum ;;
  electrs) start_electrs ;;
  down) stop_all ;;
  clean) stop_all; rm -rf "$A_DIR" "$B_DIR" "$ROOT/fulcrum-db" "$ROOT/electrs-db" "$ROOT"/*.log "$ROOT"/*.pid "$ROOT"/*.toml \
           "$ROOT/fulcrum.conf" "$ROOT/txs.json" "$ROOT/chain" "$ROOT/activation" ;;
  *) echo "usage: $0 {up|fulcrum|electrs|down|clean}" >&2; exit 1 ;;
esac
