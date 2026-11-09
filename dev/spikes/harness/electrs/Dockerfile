# Electrs Pruned for parity.py: build from a checkout of its electrs tree with the patches applied
# (commits), e.g. /mnt/Black/pruned-electrs/vendor/electrs (a7a1f57 has all 19):
#   rm -rf /tmp/electrs-src && mkdir /tmp/electrs-src && git -C <checkout> archive HEAD | tar -x -C /tmp/electrs-src
#   docker build -t fulcrum-parity-electrs -f electrs/Dockerfile /tmp/electrs-src
# (an archive, not the checkout itself, keeps its multi-GB target/ out of the build context).
# Links the system RocksDB, as Electrs Pruned's own image does.
FROM rust:1.91.1-slim-trixie AS builder
RUN apt-get update -qqy && DEBIAN_FRONTEND=noninteractive apt-get install -qqy --no-install-recommends clang cmake libclang-dev librocksdb-dev
WORKDIR /build
COPY . .
ENV ROCKSDB_INCLUDE_DIR=/usr/include ROCKSDB_LIB_DIR=/usr/lib
RUN cargo install --locked --path .
FROM debian:trixie-slim
RUN apt-get update -qqy && DEBIAN_FRONTEND=noninteractive apt-get install -qqy --no-install-recommends librocksdb9.10 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/electrs /bin/electrs
ENTRYPOINT ["/bin/electrs"]
