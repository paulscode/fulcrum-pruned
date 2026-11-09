#!/bin/bash
# Builds every prefix of the patch series (fulcrum-src, <base>..pruned) from clean, with Fulcrum's unit
# tests, and runs `Fulcrum --test all` on each: every patch must build and pass on its own.
#   ./prefix-test.sh [base]        base defaults to the tag the series sits on (v2.1.4-blake)
# Each prefix gets a fresh build directory: reusing one across prefixes lets make keep objects from the
# previous prefix (git archive stamps sources with the commit time, older than those objects). ccache
# keeps the rebuilds quick. --test all needs a writable working directory and test/ beside it.
set -euo pipefail
cd "$(dirname "$0")"
base="${1:-v2.1.4-blake}"
mkdir -p build-prefix-cache
fail=0
for c in $(git -C fulcrum-src rev-list --reverse "$base..pruned"); do
  src=$(mktemp -d) b=$(mktemp -d -p "$PWD" build-prefix-XXXX)
  git -C fulcrum-src archive "$c" | tar -x -C "$src"
  ln -s /src/test "$b/test"
  r=$(docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CCACHE_DIR=/ccache \
    -v "$PWD/build-prefix-cache:/ccache" -v "$src:/src:ro" -v "$b:/b" -w /b fulcrum-pruned-dev bash -c '
      FULCRUM_GIT_COMMIT=dev qmake6 -makefile CONFIG+=release DEFINES+=ENABLE_TESTS "QMAKE_CXX=ccache g++" /src/Fulcrum.pro >/dev/null 2>&1
      make -j"${JOBS:-18}" >make.log 2>&1 || { echo "BUILD FAILED"; grep -E " error" make.log | head -5; exit; }
      ./Fulcrum --test all >test.log 2>&1; rc=$?
      echo "tests rc=$rc, failed checks $(grep -ciE "check failed|caught exception" test.log), suites $(grep -cE "ran [0-9]+ tests? total" test.log)"') || true
  echo "$(git -C fulcrum-src log -1 --format='%h %s' "$c" | cut -c1-64): $r"
  case "$r" in "tests rc=0, failed checks 0,"*) ;; *) fail=1 ;; esac
  rm -rf "$src" "$b"
done
exit $fail
