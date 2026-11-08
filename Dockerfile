# Fulcrum Pruned: privkeyio's BLAKE2b Fulcrum (the `fulcrum` submodule) plus this package's
# patches, built the way the fork's own contrib/docker/Dockerfile builds it. That file cannot be
# used directly: its build context is the submodule alone, which has no `patches/` to apply.
# The Umbrel app builds its image from this same file, so both platforms ship the same binary.
FROM debian:13.1 AS builder

ARG MAKEFLAGS
ENV LC_ALL="C.UTF-8"

RUN apt update -y && \
    apt install -y \
        openssl git build-essential pkg-config zlib1g-dev libbz2-dev libjemalloc-dev libzmq3-dev libminiupnpc-dev \
        qt6-base-dev qmake6 patch

WORKDIR /src
COPY ./fulcrum .
# The deltas this package carries over the fork; patches/README.md says what each one is for.
# --fuzz=0 so a patch that no longer applies exactly fails the build instead of landing somewhere else.
COPY ./patches ./.patches
# And fail if there are none: a missing patches/ would otherwise build stock Fulcrum, which cannot
# index a pruned node, without a word.
RUN set -e; ls ./.patches/*.patch >/dev/null; for p in ./.patches/*.patch; do echo "applying $p"; patch -p1 --fuzz=0 <"$p"; done

# The build context is a submodule checkout, whose .git is a file pointing outside it, so the .pro
# file cannot derive the commit itself and the binary would report an empty one. The caller passes it.
ARG FULCRUM_GIT_COMMIT
ENV FULCRUM_GIT_COMMIT=$FULCRUM_GIT_COMMIT

# All cores unless MAKEFLAGS says otherwise; the aarch64 build runs under QEMU and needs them.
RUN qmake6 -makefile PREFIX=/usr Fulcrum.pro && \
    make ${MAKEFLAGS:--j$(nproc)} install

FROM debian:13.1-slim

# python3 is for FulcrumAdmin, which is a Python script.
RUN apt update && \
    apt install -y openssl libqt6network6 zlib1g libbz2-1.0 libjemalloc2 libzmq5 python3 libminiupnpc18 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder /src/Fulcrum /usr/bin/Fulcrum
COPY --from=builder /src/FulcrumAdmin /usr/bin/FulcrumAdmin

ENV LC_ALL="C.UTF-8"
# No entrypoint: StartOS runs `Fulcrum <conf>` itself, and the Umbrel app names its own command.
CMD ["Fulcrum"]
