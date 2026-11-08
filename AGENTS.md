# AGENTS.md

This is a StartOS service-package repository — it builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`,
which provides the packaging guide and agent context one level up. If you're reading this in a
bare clone with no workspace, the full guide is at <https://docs.start9.com/packaging>.

**Start every task at the recipe index** — `../start-technologies/projects/start-sdk/docs/src/recipes.md`
(or <https://docs.start9.com/packaging/recipes.html>). It maps an intent ("prompt the user to create
admin credentials", "expose a web UI") to the constructs, the reference pages, and a named production
package to copy. Find the recipe before you read this package's neighbours: a package you reach by
grepping may be non-conformant, and the recipe outranks it.

Freshly scaffolded? Work the
[New Package Checklist](../start-technologies/projects/start-sdk/docs/src/new-package-checklist.md)
(or <https://docs.start9.com/packaging/new-package-checklist.html>) from top to bottom. It is a
guide page, not a file in this repo — read it, don't copy it in.

Keep `README.md` (technical reference for an AI support or administering agent) and
`instructions.md` (end-user docs) in sync with your changes. This file restates neither:
whoever changes the package has both, so it carries only what they don't — repo mechanics,
a change that looks right and is not, where the next thing gets added, a naming trap, a
build or test invocation particular to this repo.

**Fix a defect you spot rather than reporting it** — you have the package open and the
context to be sure. File **a GitHub issue on this repo** only when the call isn't yours to
make: you can't pin the cause down, two defensible fixes exist, or it's too large to ride on
the work in hand. An open issue is a report, not a queue — implement one when you're asked
to or when it's labelled `Approved`, then close it with `Closes #<n>`.

Don't record work in the repo instead: no `TODO.md`, no `NOTES.md`, no `PLAN.md`. What you
verified, tried, and decided belongs in the commit message and the PR body.

## This repo

Fulcrum Pruned: privkeyio's BLAKE2b Fulcrum plus `patches/`, packaged to index a **pruned** node
on either chain, chosen with Select Node. Forked from privkeyio/fulcrum-startos `v2.1.4-blake_0`
(remote `privkeyio`). The project folder `/mnt/Black/fulcrum-pruned` holds the plan, the patch
working tree and the regtest harness.

- **No autoconfig task, ever.** No prune, txindex or ZeroMQ requirement: that is the point of the
  package. If you want one, the bug is elsewhere.
- **The image is the repo-root `Dockerfile`, not `fulcrum/contrib/docker/Dockerfile`.** Only the
  root one sees `patches/`. Regenerate `patches/` with `git format-patch`; never hand-edit them.
- **One database per node, `/data/db/<node id>`.** Do not share or trim one across nodes: Fulcrum
  cannot rewind across the BLAKE2b split. Anything that names the database (Reindex, the
  unreadable-index recovery, Delete Unused Indexes, backups) must stay per node.
- **Version floors follow the node's proxy, not `peer-local`** (`backends.ts`). Check every range
  with the SDK's comparator; flavored versions never match unflavored ranges.
- **Keep `utils.ts`'s `mainHostId` and `electrumPort`, and the health ids `primary` and
  `sync-progress`.** Dependents import and gate on them.
- **Prefill the Configure form with only the keys its spec declares; never spread the whole config.**
  `fulcrum.conf`'s `banner` key is the _path_ to `banner.txt`.
- **`main` must `const` the config _after_ writing `bitcoind`, `datadir` and `rpccookie`**, or
  that write registers as a change and the daemon restarts itself on every start.
- **`peering` and `announce` stay pinned false.**
- **Never run `npm install`/`npm update`.** `npm ci` installs exactly the lockfile. A new
  dependency's lock entry is copied by hand from a sibling package.
- **i18n is en_US only**, so `gen-i18n-dict.py` (in the workspace) may regenerate `default.ts`.
  Once `translations.ts` has entries, the indices are the join key and must be kept.
- **Build with the workspace's `release.sh`** (`../release.sh fulcrum-pruned-startos --arch x86`
  for iteration), which refuses an `osVersion` below 0.4.0.2. Releases are local, never CI.
