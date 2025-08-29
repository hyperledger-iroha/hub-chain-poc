//! Smartcontract which creates new NFT for every user
#![no_std]

extern crate alloc;
#[cfg(not(test))]
extern crate panic_halt;

use core::ops::ControlFlow;

use alloc::borrow::ToOwned;
use alloc::collections::btree_map::BTreeMap;
use alloc::collections::btree_set::BTreeSet;
use alloc::vec::Vec;

use dlmalloc::GlobalDlmalloc;
use eyre::{Context as _, OptionExt as _, Result, bail, eyre};
use iroha_crypto::SignatureOf;
use iroha_trigger::data_model::block::BlockHeader;
use iroha_trigger::log::*;
use iroha_trigger::prelude::*;
use serde::{Deserialize, Serialize};

#[global_allocator]
static ALLOC: GlobalDlmalloc = GlobalDlmalloc;

#[derive(Deserialize)]
struct Config {
    /// Operation mode of this trigger - hub or domestic.
    ///
    /// Alters the behaviour of how transfers are made upon verification.
    mode: OperationMode,
    /// Storage with admin-only write access. Contains [`ChainSnapshot`]\(s).
    ///
    /// The trigger is deployed separately for each connected chain. Thus, there is
    /// only one trigger on each domestic chain (domestic-hub), and many triggers
    /// on the hub chain (hub-\*domestic). Therefore, on the hub chain, we use
    /// a single admin storage to store multiple chain snapshots. We deploy a separate
    /// trigger for each chain working with its own entry in the admin store.
    admin_store: NftId,
    /// Points to the exact key in the admin storage containing [`ChainSnapshot`]
    /// for this trigger to work with.
    admin_store_chain_key: Name,
    /// Storage to which the relay has write access. Contains [`RelayBlockMessage`].
    relay_store: NftId,
    /// Points to the exact key in the relay storage containing [`RelayBlockMessage`]
    /// this trigger will read.
    relay_store_message_key: Name,
    /// Global information about all the chains in the hub chain network.
    chains: BTreeMap<ChainId, ChainConfig>,
}

/// Trigger operation mode
#[derive(Deserialize)]
#[serde(tag = "type")]
enum OperationMode {
    /// Trigger is deployed on the hub chain
    Hub,
    /// Trigger is deployed on a domestic chain
    Domestic(ChainId),
}

/// Information about a specific chain
#[derive(Deserialize)]
struct ChainConfig {
    /// Omnibus account of that chain presented on the chain _this trigger is deployed on_.
    omnibus_account: AccountId,
}

/// Message provided by an untrusted relay that the trigger is going to verify
#[derive(Deserialize)]
struct RelayBlockMessage {
    /// Header of the new block. Must be consequent to the block in [`ChainSnapshot`].
    header: BlockHeader,
    /// Block signatures. Will be verified against validators set in [`ChainSnapshot`].
    signatures: BTreeSet<SignatureOf<BlockHeader>>,
    /// _Interesting_ transactions in the given block.
    ///
    /// Interesting means they contain e.g. [`Transfer`] instructions that the trigger will
    /// scan and act on. Currently, it is only transfers; later, it could include
    /// [`RegisterBox::Peer`] (and unregister) to change the validators set.
    ///
    /// The goal of the PoC is to show that a relay does not need to send the **entire block**
    /// (i.e. all of its transactions), but only a subset of them. Trigger can verify them using
    /// their [`CommittedTransaction::entrypoint_proof`] against [`BlockHeader::merkle_root`].
    interesting_transactions: Vec<CommittedTransaction>,
}

/// Memory about a chain.
#[derive(Deserialize, Serialize)]
struct ChainSnapshot {
    /// Must be set in the beginning
    validators: BTreeSet<PublicKey>,
    /// None in the beginning
    block: Option<BlockHeader>,
}

#[iroha_trigger::main]
fn main(host: Iroha, ctx: Context) {
    main_result(host, ctx).unwrap();
}

fn main_result(host: Iroha, ctx: Context) -> Result<()> {
    info!("Hello from the Hub Chain Trigger!");

    if !matches!(ctx.event, EventBox::Time(_)) {
        bail!("Trigger is designed to work as a time trigger");
    }
    // TODO: verify authority?

    let config = Config::read(&host, &ctx)?;
    let mut snapshot = ChainSnapshot::read(&host, &config)?;
    let Some(message) = RelayBlockMessage::read(&host, &config)? else {
        info!("No messages found, exiting");
        return Ok(());
    };

    match check_block_height(&snapshot, &message)? {
        ControlFlow::Break(()) => {
            info!("No updates detected, exiting");
            return Ok(());
        }
        ControlFlow::Continue(()) => {
            debug!("Updates found, processing");
        }
    }

    validate_prev_block_hash(&snapshot, &message)?;
    validate_block_signatures(&snapshot, &message)?;
    process_transactions(&host, &config, &message, &mut snapshot)?;
    snapshot.write(&host, &config)?;

    info!("Trigger completed successfully!");
    Ok(())
}

impl Config {
    fn read(host: &Iroha, ctx: &Context) -> Result<Self> {
        let meta = host
            .query(FindTriggers)
            .filter_with(|x| x.id.eq(ctx.id.to_owned()))
            .select_with(|x| x.action.metadata)
            .execute_single()
            .map_err(|err| eyre!("failed query: {err}"))?;

        let config = meta
            .get("config")
            .ok_or_eyre("cannot find config in trigger metadata")?
            .try_into_any()
            .wrap_err("cannot deserialize config")?;

        Ok(config)
    }
}

impl ChainSnapshot {
    fn read(host: &Iroha, config: &Config) -> Result<Self> {
        let value = host
            .query(FindNfts)
            .filter_with(|x| x.id.eq(config.admin_store.to_owned()))
            .select_with(|x| x.content.key(config.admin_store_chain_key.to_owned()))
            .execute_single()
            .map_err(|err| eyre!("failed query: {err}"))?
            .try_into_any()
            .wrap_err("cannot deserialize chain snapshot")?;

        Ok(value)
    }

    fn write(&self, host: &Iroha, config: &Config) -> Result<()> {
        host.submit(&SetKeyValue::nft(
            config.admin_store.to_owned(),
            config.admin_store_chain_key.to_owned(),
            Json::new(&self),
        ))
        .map_err(|err| eyre!("failed tx: {err}"))
    }
}

impl RelayBlockMessage {
    fn read(host: &Iroha, config: &Config) -> Result<Option<Self>> {
        let value = host
            .query(FindNfts)
            .filter_with(|x| x.id.eq(config.relay_store.to_owned()))
            .select_with(|x| x.content.key(config.relay_store_message_key.to_owned()))
            .execute_single_opt()
            .map_err(|err| eyre!("failed query: {err}"))?
            .map(|json| json.try_into_any())
            .transpose()?;

        Ok(value)
    }
}

fn check_block_height(
    chain: &ChainSnapshot,
    message: &RelayBlockMessage,
) -> Result<ControlFlow<()>> {
    let snapshot_height = chain.block.map(|x| x.height().get()).unwrap_or(0);
    let msg_height = message.header.height().get();

    if snapshot_height == msg_height {
        Ok(ControlFlow::Break(()))
    } else if snapshot_height + 1 == msg_height {
        Ok(ControlFlow::Continue(()))
    } else {
        Err(eyre!(
            "Expected message with height {snapshot_height} or + 1, got {msg_height}"
        ))
    }
}

fn validate_prev_block_hash(chain: &ChainSnapshot, message: &RelayBlockMessage) -> Result<()> {
    let expected = chain.block.map(|x| x.hash());
    let actual = message.header.prev_block_hash();

    if actual != expected {
        bail!("Previous block hash mismatch: expected {expected:?}, got {actual:?}");
    }

    Ok(())
}

fn validate_block_signatures(chain: &ChainSnapshot, message: &RelayBlockMessage) -> Result<()> {
    if message.signatures.is_empty() {
        bail!("No signatures")
    }

    let required_count = chain.validators.len() / 3 * 2;

    // PERF: naive implementation
    let hash = message.header.hash();
    let recognized = chain
        .validators
        .iter()
        .filter(|pubkey| {
            message
                .signatures
                .iter()
                .any(|signature| signature.verify_hash(pubkey, hash).is_ok())
        })
        .count();

    if recognized < required_count {
        bail!(
            "Invalid block signatures: recognized {recognized}, required at least {required_count}"
        );
    }

    Ok(())
}

// Assuming max 2^9 = 512 transactions per block
const MAX_VERIFY_DEPTH: usize = 9;

fn process_transactions(
    host: &Iroha,
    config: &Config,
    message: &RelayBlockMessage,
    chain: &mut ChainSnapshot,
) -> Result<()> {
    let block_merkle_root = message
        .header
        .merkle_root()
        .ok_or_eyre("Block contains no transactions")?;

    for tx in &message.interesting_transactions {
        let tx_hash = tx.entrypoint_hash();

        if *tx.block_hash() != message.header.hash() {
            bail!("Transaction {tx_hash} block hash differs");
        }

        let proof = tx.entrypoint_proof().clone();
        if !proof.verify(&tx_hash, &block_merkle_root, MAX_VERIFY_DEPTH) {
            bail!("Cannot prove that the transaction {tx_hash} is part of the block");
        }

        // boom - valid

        // now match and apply

        if let TransactionEntrypoint::External(tx) = tx.entrypoint()
            && let Executable::Instructions(instructions) = tx.instructions()
        {
            todo!()
        }
    }

    Ok(())
}
