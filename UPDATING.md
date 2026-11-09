# Updating

The image is built from the `fulcrum` submodule, pinned to a tag of
[privkeyio/Fulcrum](https://github.com/privkeyio/Fulcrum) (BLAKE2b header support over
[cculianu/Fulcrum](https://github.com/cculianu/Fulcrum)), plus this package's `patches/`.
An upstream Fulcrum release reaches this package once privkeyio merges and tags it.

## The patch working tree

The patches are made in a branch `pruned` of a privkeyio/Fulcrum clone, checked out as a git
worktree at `dev/spikes/fulcrum-src` (ignored by git). On a fresh clone of this repository,
recreate it from the pinned tag and the patches:

```sh
git clone https://github.com/privkeyio/Fulcrum ../Fulcrum-blake2b   # anywhere outside this repo
git -C ../Fulcrum-blake2b worktree add "$PWD/dev/spikes/fulcrum-src" -b pruned v2.1.4-blake
git -C dev/spikes/fulcrum-src am "$PWD"/patches/*.patch
```

`dev/spikes/build.sh [test]` builds it in the dev image (build that first:
`docker build -t fulcrum-pruned-dev dev/spikes/devimage`), and `dev/spikes/harness/` is the
regtest harness (`setup.sh`, `check.py`, and `parity.py`, which compares against Electrs Pruned;
see the comments at their tops).

## A new Fulcrum version

```sh
gh release view -R cculianu/Fulcrum --json tagName -q .tagName
gh release list -R privkeyio/Fulcrum -L 5
```

The version the fork builds is `VERSION` in `fulcrum/src/Common.h`. Pin a tag (`vX.Y.Z-blake`),
never a branch.

1. Rebase the series onto the new tag in the working tree:

   ```sh
   git -C ../Fulcrum-blake2b fetch --tags origin
   git -C dev/spikes/fulcrum-src rebase --onto <new tag> <old tag> pruned
   ```

   Check that every patch builds and passes Fulcrum's unit tests on its own:
   `dev/spikes/prefix-test.sh` builds each prefix of the series from clean and runs
   `Fulcrum --test all` on it. Then build the dev binary with tests (`dev/spikes/build.sh test`)
   and run the harness on both chains, through the proxy and against the archival node:

   ```sh
   cd dev/spikes/harness
   CHAIN=sha256 ./setup.sh up && ./setup.sh fulcrum && python3 -I check.py --wait
   FULCRUM_NODE=nodeA FULCRUM_BITCOIND_PORT=19101 ./setup.sh fulcrum && python3 -I check.py --wait
   ./setup.sh clean; CHAIN=blake2b ./setup.sh up   # and the same two runs
   ```

   And Electrs Pruned beside it, on each chain, through the proxy (build its image once, from
   `dev/spikes/harness`, as the top of `electrs/Dockerfile` shows):

   ```sh
   ./setup.sh fulcrum && ./setup.sh electrs && python3 -I parity.py --wait
```

   Then regenerate the patches, and update the tag named in `patches/README.md`:

   ```sh
   rm patches/*.patch
   git -C dev/spikes/fulcrum-src format-patch --no-signature -o "$PWD/patches" <new tag>..pruned
   ```

2. Point the submodule at the tag:

   ```sh
   git -C fulcrum fetch --tags origin
   git -C fulcrum checkout <new tag>
   git add fulcrum
   ```

3. Bump the version: see below, with `<new version>:0`.

## A package-only release (`2.1.4:1`, and so on)

Edit `startos/versions/current.ts` in place: the new `version`, its release notes, and its
migrations (empty `up` and `down` when nothing changes on disk). `index.ts` stays as it is. A
released version gets a file of its own and a place in `other` only when it has a migration of
its own that must still run on the way up (the SDK's `versions.md`, "When to Create a New Version
File"); git history keeps the old release notes.

## Fixes from privkeyio's package

This repository began from privkeyio/fulcrum-startos `v2.1.4-blake_0` (remote `privkeyio`). Its
later fixes are not merged automatically:

```sh
git fetch privkeyio --tags
git log --oneline v2.1.4-blake_0..privkeyio/master -- startos
```

Port what applies by hand. Most of its `startos/` has been rewritten here (Select Node, one
index per node, the chain guard), so a merge would mostly conflict.

## Building and releasing

The Makefile passes the submodule's commit, marked `+pruned`, to the image build as
`FULCRUM_GIT_COMMIT`, so the binary reports what it is. The Dockerfile applies the patches with
`--fuzz=0`, and fails if there are none, so a patch that no longer applies fails the build.

Use the workspace's `release.sh` (one level up). It builds only from a clean tree, and
`--publish` refuses an s9pk built from a commit other than HEAD: finish every repository change,
then build, then sign.
