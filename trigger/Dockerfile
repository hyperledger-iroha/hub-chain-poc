FROM hyperledger/iroha:experimental-xx-858df795cc8ea480a214ff73f3087a3bbf5f7d85 AS iroha

FROM rust:1.89-bullseye
WORKDIR /app

COPY rust-toolchain.toml .
RUN rustup install

COPY . .
RUN --mount=type=cache,target=/root/.cargo/git/db \
    --mount=type=cache,target=/root/.cargo/registry/cache \
    --mount=type=cache,target=/root/.cargo/registry/index \
    cargo fetch
COPY --from=iroha /usr/local/bin/kagami /usr/local/bin/
RUN mkdir -p outputs && kagami wasm build . --out-file outputs/hub_chain_trigger.wasm
