# fulcrum-pruned

Project folder for **Fulcrum Pruned**: Fulcrum (C++ Electrum server) made to work against a
**pruned** node on either chain (SHA256 or BLAKE2b), packaged for StartOS (`fulcrum-pruned`)
and Umbrel (`paulscode-fulcrum-pruned`). The second pruned-node indexer beside Electrs
Pruned, so a server can run two pruned nodes with an indexer each. The Frigate companions
(`/mnt/Black/frigate-companions`) come after this and use it as a backend.

**Start with `internal_docs/IMPLEMENTATION-PLAN.md`.** It holds the decisions already made,
the upstream analysis, related project locations, test servers, the release and signing
process, the registry and Umbrel store, and the gotchas. `internal_docs/`, `vendor/` and
`packaging/` are gitignored.

- `vendor/Fulcrum-upstream`: cculianu/Fulcrum v2.1.3
- `vendor/Fulcrum-blake2b`: privkeyio/Fulcrum `v2.1.3-blake`, the BLAKE2b fork to build on
- `vendor/fulcrum-startos`: Start9Labs/fulcrum-startos (HEAD is SDK 3; `4c1aaec` is the last SDK 2.0.9 commit)
- `vendor/fulcrum-startos-blake2b`: privkeyio/fulcrum-startos (SDK 2.0.9)
- `tools/i18nscan.cjs`: flags non-string `i18n()` params (SDK 2.0.9 throws on numbers).
  Run from a package dir: `node /mnt/Black/fulcrum-pruned/tools/i18nscan.cjs .`
