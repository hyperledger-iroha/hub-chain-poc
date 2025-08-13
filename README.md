# Hub Chain PoC

Proof-of-Concept implementation of a Hub Chain based on Hyperledger Iroha 2.

The core idea of a hub chain is to move assets across Iroha 2 blockchains (called _domestic chains_) using a **central hub chain**.

The transfer is split in two steps:

1. Chain 1 → Hub Chain
2. Hub Chain → Chain 2

Each step involves a **prover** (source chain) and a **verifier** (target chain). However, for now we will be implementing a simple flow without proofs.

## Running the demo

Prerequisites:

- [Deno installed](https://deno.com/) (version 2+) (shortcut: `curl -fsSL https://deno.land/install.sh | sh`)
- Docker Compose (or Podman)

#### 1. Generate configuration

```sh
deno task generate
```

This will generate `config` directory, where you can see/inspect all of the configuration for the PoC: compose file, genesis files, etc.

#### 2. Run

```sh
docker-compose -f config/docker-compose.yml up
```

This will spin up everything.

#### 3. Open UI in the browser

Open your browser at http://localhost:9900

#### Troubleshooting

- Make sure you don't have occupied ports at 8080-8090 and 9900

## Stage 1 _(you are here)_: No-proof

In this version, there is no prover-verifier mechanism. Cross-chain transfers are done by the trusted relays.

This lacks the core requirement for the hub chain, but may be a good preparation to introduce a prover-verifier mechanism later based on this work (even if there will be drastic design changes).

### Design

- There are $N$ domestic chains and 1 hub chain,
- Each _domestic_ chain has an arbitrary amount of user accounts, $N - 1$ _omnibus_ accounts, and 1 _relay_ account
- Hub chain has $N$ omnibus accounts and $N$ relay accounts
- _All_ chains have the same numeric asset definitions (e.g. `rose#wonderland`, `time#looking_glass` etc)
- Balances of omnibus accounts are representing totals of their associated chain in order. If some asset is minted on some chain, it must be minted to the omnibus account of this chain on all other chains (both domestic and the hub).
- Transfers are expressed as native `Transfer` instructions. To make a **cross-chain transfer**, user must transfer to an omnibus account of the target chain and attach metadata with that chain's destination account `destination: AccountId`. Then, relays forward this transfer through the hub to the destination chain and account.

### Example accounts layout

- Chain `A`
  - Account 1
  - Account 2
  - Account 3
  - Omnibus Account `B` (e.g. `omni@chain_B`)
  - Omnibus Account `C`
  - Relay `A`
- Chain `B`
  - Account 1
  - Account 2
  - Account 3
  - Relay `B`
  - Omnibus Account `A`
  - Omnibus Account `C`
- Chain `C`
  - _...user accounts..._
  - Relay `C`
  - Omnibus Account `A`
  - Omnibus Account `B`
- Hub Chain
  - Relay `A`
  - Relay `B`
  - Relay `C`
  - Omnibus Account `A`
  - Omnibus Account `B`
  - Omnibus Account `C`

### Transfer flow example

Transfer `rose##alice@wonderland` (i.e. asset `rose#wonderland` from account `alice@wonderland`) of quantity 42 on chain `aaa` to account `mad_hatter@looking_glass` on chain `bbb`:

1. On Chain `aaa` (by user): `Transfer`
   - `object=rose##alice@wonderland`
   - `target=omni@chain_bbb`
   - `quantity=42`
   - `metadata(destination=mad_hatter@looking_glass)`
2. On Hub Chain (by relay of chain `aaa`): `Transfer`
   - `object=rose#wonderland#omni@chain_aaa`
   - `target=omni@chain_bbb`
   - `quantity=42`
   - `metadata(destination=mad_hatter@looking_glass)`
3. On Chain `bbb` (by relay of chain `bbb`): `Transfer`
   - `object=rose#wonderland#omni@chain_aaa`
   - `target=mad_hatter@looking_glass`
   - `quantity=42`

### Relay inputs (configuration)

- `authority: AccountId` + `authorityPrivateKey: PrivateKey` - credentials of the relay account
- `omnibus_accounts:` `AccountId[]` - list of all chain omnibus accounts, e.g. `omni@chain_a`, `omni@chain_b`
- `domestic_torii_url: Url`, `hub_torii_url: Url` - URLs of the two chains
- `domestic_omnibus_account: AccountId` - account associated with the connected domestic chain (needed as a target on the hub chain)

### Relay function

- Subscribe to domestic chain transfers targeting _all_ omnibus accounts[^1]
  - When `Transfer(AssetId, TargetOmnibusAccountId, Numeric)` with metadata `destination: AccountId` where `AssetId` = `AssetDefinitionId` + source `AccountId` happens:
    - On Hub chain, create `Transfer(AssetId, TargetOmnibusAccountId, Numeric)` with metadata `destination: AccountId` (forwarded) where `AssetId` = `AssetDefinitionId` + _domestic omnibus_ `AccountId`
- Subscribe to hub chain transfers targeting _only_ domestic omnibus account.
  - Extract source omnibus `AccountId` and destination `AccountId`, and make a `Transfer(SourceOmnibusAssetId, DestinationAccountId, Numeric)`

### Limitations

This is an intentionally simple design.

- Relays must be trusted
- Since relays are subscribing to events stream, it is possible to skip a transfer event in case of a race condition/connection issues

### Demo

Configuration:

- 3 domestic chains + 1 hub chain.
- 3 user accounts on each domestic chain (9 accounts total).
- **Same** 3 assets on all chains. E.g. each domestic chain would have an asset definition `rose#wonderland`.
- Assign some starting balances for accounts

UI:

- Display balances of each account on each chain, update in real time
- Display block height of each chain, update in real time
- Provide a form to initiate a **cross-chain** transfer: from any account, to any account, for any asset id and quantity

## Stage 2: Introduce prover-verifier

This would significantly increase complexity of the design.

Core ideas:

- Relays are not trusted
- Deploy a **verifier** as a trigger (WASM) on each chain. It is a decentralised on-chain logic.
- Verifier has knowledge of other chain's validators set (set of public keys)
- Relay must submit block headers subsequently to the verifier trigger (both from domestic chain to hub chain and vice versa). Verifier ensures the block header is a valid continuation (height match, hash match, signed by known validators)
- Relay must submit _proofs_ of transfer intentions on the source chain to the verifier on the target chain
- Proof is, roughly, a transaction payload which contains the instruction (or multiple ones) and a **merkle proof** of this transaction being a part of the latest block. Payload is sufficient to get transaction's _hash_. Transaction must be in the latest block (whose header was submitted to the verified previously). Since block header contains merkle tree of the transactions, verifier can validate that the given transaction is indeed a part of the given block, which is valid.

How exactly it would look like in terms of implementation is to be decided.

## Stage 3: ZK?

To think about after Stage 2 is completed.
