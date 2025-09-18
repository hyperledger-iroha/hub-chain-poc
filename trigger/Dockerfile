FROM rust:1.89-bullseye
WORKDIR /app

COPY rust-toolchain.toml .
RUN rustup install

COPY Cargo.lock Cargo.toml .
COPY .cargo .cargo
COPY src src
RUN cargo build --release

RUN mkdir -p outputs && cp target/wasm32-unknown-unknown/release/hub_chain_trigger.wasm ./outputs/
