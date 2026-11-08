# Build environment matching Fulcrum's contrib/docker/Dockerfile builder stage, for
# incremental builds of a mounted source tree while writing patches.
FROM debian:13.1
ENV LC_ALL=C.UTF-8
RUN apt update -y && apt install -y \
        openssl git build-essential pkg-config zlib1g-dev libbz2-dev libjemalloc-dev libzmq3-dev \
        libminiupnpc-dev qt6-base-dev qmake6 patch ccache && rm -rf /var/lib/apt/lists/*
WORKDIR /src
