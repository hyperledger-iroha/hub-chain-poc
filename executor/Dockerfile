FROM hyperledger/iroha:experimental-xx-858df795cc8ea480a214ff73f3087a3bbf5f7d85 AS iroha

FROM rust:1.89-bullseye
WORKDIR /app

ARG IROHA_REV=858df795cc8ea480a214ff73f3087a3bbf5f7d85
RUN git init && \
    git remote add origin https://github.com/hyperledger-iroha/iroha.git && \
    git fetch origin $IROHA_REV && \
    git reset --hard FETCH_HEAD

COPY --from=iroha /usr/local/bin/kagami /usr/local/bin/
# TODO: add rust-src component to Iroha's rust-toolchain.toml
RUN mkdir -p outputs && \
    rustup component add rust-src && \
    kagami wasm build wasm/libs/default_executor --out-file outputs/executor.wasm
