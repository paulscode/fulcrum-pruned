ARCHES := x86 arm
# The image build cannot read the submodule's commit itself; see startos/manifest/index.ts
# The submodule's commit, marked as carrying this package's patches so the binary says what it is.
export FULCRUM_GIT_COMMIT := $(shell git -C fulcrum describe --always --dirty --match 'NOT A TAG' 2>/dev/null)
# Empty would ship a binary that cannot say what it is, and nothing else would fail, so stop here.
ifeq ($(strip $(FULCRUM_GIT_COMMIT)),)
ifeq ($(filter clean,$(MAKECMDGOALS)),)
$(error Could not read the Fulcrum submodule's commit. Run `git submodule update --init`.)
endif
endif
ifneq ($(strip $(FULCRUM_GIT_COMMIT)),)
FULCRUM_GIT_COMMIT := $(FULCRUM_GIT_COMMIT)+pruned
endif
# overrides to s9pk.mk must precede the include statement
include node_modules/@start9labs/start-sdk/s9pk.mk
