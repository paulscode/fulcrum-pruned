#!/bin/bash
# Incremental build of spikes/fulcrum-src in the dev container.
#   ./build.sh          release build in spikes/build/Fulcrum
#   ./build.sh test     build with Fulcrum's unit tests (ENABLE_TESTS) in spikes/build-test/Fulcrum
set -e
cd "$(dirname "$0")"
dir=build; extra=""
[ "$1" = test ] && { dir=build-test; extra="DEFINES+=ENABLE_TESTS"; }
mkdir -p "$dir"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CCACHE_DIR=/b/.ccache \
  -v "$PWD/fulcrum-src:/src:ro" -v "$PWD/$dir:/b" -w /b fulcrum-pruned-dev \
  bash -c "set -e; [ -f Makefile ] || FULCRUM_GIT_COMMIT=dev qmake6 -makefile CONFIG+=release $extra 'QMAKE_CXX=ccache g++' /src/Fulcrum.pro >/dev/null; make -j\${JOBS:-18} >make.log 2>&1 || { grep -E 'error|Error' make.log | head -40; exit 1; }; grep -E ': warning:' make.log | grep -v '^/usr' | head -20; ls -la Fulcrum"
