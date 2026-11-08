# dev/

Development tooling for the Fulcrum Pruned package (the repository root). It began in the
project folder `/mnt/Black/fulcrum-pruned`, whose `spikes/` and `tools/` are now symlinks here.

- `spikes/devimage/`: Debian 13.1 + Qt 6 build image (`fulcrum-pruned-dev`), matching Fulcrum's
  own Docker builder.
- `spikes/build.sh [test]`: incremental build of `spikes/fulcrum-src` (a git worktree of
  privkeyio/Fulcrum, branch `pruned`, where the patch series is made; ignored);
  `test` adds Fulcrum's unit tests. `spikes/run.sh` runs a build.
- `spikes/harness/`: regtest harness, pruned node behind btc-rpc-proxy, SHA256 or BLAKE2b;
  `check.py` asserts each patch. See the comment at the top of `setup.sh`.
- `tools/i18nscan.cjs`: flags non-string `i18n()` params. Run from the package root:
  `node dev/tools/i18nscan.cjs .`
