# Updating the upstream version

The image is built from the `fulcrum` submodule, pinned to a tag of
[privkeyio/Fulcrum](https://github.com/privkeyio/Fulcrum) (BLAKE2b header support over
[cculianu/Fulcrum](https://github.com/cculianu/Fulcrum)), plus this package's `patches/`.
An upstream Fulcrum release reaches this package once privkeyio merges and tags it.

## Determining the upstream version

```sh
gh release view -R cculianu/Fulcrum --json tagName -q .tagName
gh release list -R privkeyio/Fulcrum -L 5
```

The version the fork builds is `VERSION` in `fulcrum/src/Common.h`. Pin a tag (`vX.Y.Z-blake`),
never a branch.

## Applying the bump

1. Rebase the patch series onto the new tag, in a working branch of the fork (kept as a git
   worktree of a privkeyio/Fulcrum clone at `dev/spikes/fulcrum-src`, branch `pruned`; ignored):

   ```sh
   git rebase --onto <new tag> <old tag> pruned
   ```

   Build with `DEFINES+=ENABLE_TESTS`, run `Fulcrum --test all` from the source directory, and run
   the regtest harness (`dev/spikes/harness/`, both `CHAIN=sha256` and `CHAIN=blake2b`). Then
   regenerate:

   ```sh
   rm patches/*.patch
   git -C <fork tree> format-patch --no-signature -o "$PWD/patches" <new tag>..pruned
   ```

   Update the tag named in `patches/README.md`.

2. Point the submodule at the tag:

   ```sh
   git -C fulcrum fetch --tags origin
   git -C fulcrum checkout <new tag>
   git add fulcrum
   ```

3. In `startos/versions/current.ts`, set `version` to `<new version>:0`, move the old one into
   `startos/versions/` as a version file if it was released, and write the release notes.

The Makefile passes the submodule's commit, marked `+pruned`, to the image build as
`FULCRUM_GIT_COMMIT`, so the binary reports what it is. The Dockerfile applies the patches with
`--fuzz=0`, so a patch that no longer applies fails the build.
