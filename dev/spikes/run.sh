#!/bin/bash
# Run a built Fulcrum in the dev container (host network, so it reaches a local regtest node or proxy).
#   BIN=build-test/Fulcrum ./run.sh --test all
cd "$(dirname "$0")"
exec docker run --rm -i --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/w" -w /w fulcrum-pruned-dev "./${BIN:-build/Fulcrum}" "$@"
