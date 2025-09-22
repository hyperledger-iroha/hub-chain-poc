//! Smartcontract which creates new NFT for every user
#![no_std]

extern crate alloc;
#[cfg(not(test))]
extern crate panic_halt;

use core::marker::PhantomData;
use core::ops::ControlFlow;
use core::str::FromStr as _;

use alloc::borrow::ToOwned;
use alloc::collections::btree_map::BTreeMap;
use alloc::collections::btree_set::BTreeSet;
use alloc::string::String;
use alloc::vec::Vec;

use anyhow::{Context as _, Result, anyhow, bail};
use dlmalloc::GlobalDlmalloc;
use iroha_crypto::SignatureOf;
use iroha_trigger::data_model::block::BlockHeader;
use iroha_trigger::log::*;
use iroha_trigger::prelude::*;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

#[global_allocator]
static ALLOC: GlobalDlmalloc = GlobalDlmalloc;

/// The key from which the trigger will read its config in its own metadata.
const SELF_CONFIG_KEY: &str = "config";

#[derive(Deserialize)]
struct Config {
    /// Operation mode of this trigger - hub or domestic.
    ///
    /// Alters the behaviour of how transfers are made upon verification.
    mode: OperationMode,
    /// Storage with admin-only write access. Contains the [`Checkpoint`] this trigger works with.
    checkpoint_addr: KeyValueAddress<Checkpoint>,
    /// Storage to which the relay has write access. Contains [`RelayBlockMessage`].
    block_message_addr: KeyValueAddress<RelayBlockMessage>,
    /// Global information about all the chains in the hub chain network.
    chains: BTreeMap<ChainId, ChainConfig>,
}

/// Generic address in an on-chain key-value storage (metadata) pointing to a specific metadata
/// key.
#[derive(Deserialize)]
struct KeyValueAddress<T> {
    /// What entity to look in for metadata
    entity: KeyValueAddressEntity,
    /// Metadata key
    key: Name,
    _value: PhantomData<T>,
}

#[derive(Deserialize)]
enum KeyValueAddressEntity {
    Domain(DomainId),
    Account(AccountId),
    AssetDefinition(AssetDefinitionId),
    Nft(NftId),
    Trigger(TriggerId),
}

/// Trigger operation mode
#[derive(Deserialize)]
#[serde(tag = "type")]
enum OperationMode {
    /// Trigger is deployed on the hub chain
    Hub {
        /// The chain id this trigger works with. (i.e. whose [`Checkpoint`] it tracks)
        domestic_chain: ChainId,
        approved_transfers_addr: KeyValueAddress<HubChainTransferPayload>,
    },
    /// Trigger is deployed on a domestic chain
    Domestic {
        /// Which domestic chain
        chain: ChainId,
    },
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
    /// Header of the new block. Must be consequent to the block in [`Checkpoint`].
    header: BlockHeader,
    /// Block signatures. Will be verified against validators set in [`Checkpoint`].
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
struct Checkpoint {
    /// Must be set in the beginning
    validators: BTreeSet<PublicKey>,
    /// None in the beginning
    block: Option<BlockHeader>,
}

/// Since the trigger on hub chain cannot "show" the transfer as a [`Transfer`] itself,
/// we have to use a JSON payload and set it as a metadata somewhere.
#[derive(Serialize, Deserialize, Debug)]
struct HubChainTransferPayload {
    source_chain: ChainId,
    source_account: AccountId,
    destination_chain: ChainId,
    destination_account: AccountId,
    asset: AssetDefinitionId,
    object: Numeric,
}

#[iroha_trigger::main]
fn main(host: Iroha, ctx: Context) {
    main_result(host, ctx).dbg_unwrap();
}

fn main_result(host: Iroha, ctx: Context) -> Result<()> {
    info!("Hello from the Hub Chain Trigger!");

    if ctx.curr_block.is_genesis() {
        debug!("Skipping genesis block");
        return Ok(());
    }

    if !matches!(ctx.event, EventBox::Time(_)) {
        bail!("Trigger is designed to work as a time trigger");
    }
    // TODO: verify authority?

    let config: Config = KeyValueAddress::new(
        KeyValueAddressEntity::Trigger(ctx.id.to_owned()),
        ctx.id.name().to_owned(),
    )
    .read(&host)?
    .ok_or_else(|| anyhow!("cannot find config"))?;
    let mut checkpoint = config
        .checkpoint_addr
        .read(&host)?
        .ok_or_else(|| anyhow!("cannot find checkpoint"))?;
    let Some(message) = config.block_message_addr.read(&host)? else {
        info!("No messages found, exiting");
        return Ok(());
    };

    match check_block_height(&checkpoint, &message)? {
        ControlFlow::Break(()) => {
            info!("No updates detected, exiting");
            return Ok(());
        }
        ControlFlow::Continue(()) => {
            debug!("Updates found, processing");
        }
    }

    validate_prev_block_hash(&checkpoint, &message)?;
    validate_block_signatures(&checkpoint, &message)?;
    process_transactions(&host, &config, &message)?;

    checkpoint.block = Some(message.header);
    config.checkpoint_addr.write(&host, &checkpoint)?;

    info!("Trigger completed successfully!");
    Ok(())
}

impl Config {
    fn chain_by_omnibus_account(&self, account: &AccountId) -> Option<&ChainId> {
        self.chains
            .iter()
            .find(|(_, x)| &x.omnibus_account == account)
            .map(|(chain, _)| chain)
    }

    fn omnibus_account_by_chain(&self, chain: &ChainId) -> Option<&AccountId> {
        self.chains.get(chain).map(|x| &x.omnibus_account)
    }
}

impl<T> KeyValueAddress<T> {
    fn new(entity: KeyValueAddressEntity, key: impl Into<Name>) -> Self {
        Self {
            entity,
            key: key.into(),
            _value: <_>::default(),
        }
    }
}

impl<T: DeserializeOwned> KeyValueAddress<T> {
    fn read(&self, host: &Iroha) -> Result<Option<T>> {
        let meta = match &self.entity {
            KeyValueAddressEntity::Trigger(id) => host
                .query(FindTriggers)
                .filter_with(|x| x.id.eq(id.to_owned()))
                .select_with(|x| x.action.metadata)
                .execute_single(),
            _ => todo!(),
        }
        .map_err(|err| anyhow!("failed query: {err}"))?;

        let maybe_value = meta
            .get(&self.key)
            .map(|json| json.try_into_any().with_context(|| "cannot deserialize"))
            .transpose()?;

        Ok(maybe_value)
    }
}

impl<T: Serialize> KeyValueAddress<T> {
    fn write(&self, host: &Iroha, value: &T) -> Result<()> {
        match &self.entity {
            KeyValueAddressEntity::Nft(id) => host.submit(&SetKeyValue::nft(
                id.to_owned(),
                self.key.to_owned(),
                Json::new(value),
            )),
            _ => todo!(),
        }
        .map_err(|err| anyhow!("failed tx: {err}"))
    }
}

fn check_block_height(
    checkpoint: &Checkpoint,
    message: &RelayBlockMessage,
) -> Result<ControlFlow<()>> {
    let snapshot_height = checkpoint.block.map(|x| x.height().get()).unwrap_or(0);
    let msg_height = message.header.height().get();

    if snapshot_height == msg_height {
        Ok(ControlFlow::Break(()))
    } else if snapshot_height + 1 == msg_height {
        Ok(ControlFlow::Continue(()))
    } else {
        Err(anyhow!(
            "Expected message with height {snapshot_height} or + 1, got {msg_height}"
        ))
    }
}

fn validate_prev_block_hash(chain: &Checkpoint, message: &RelayBlockMessage) -> Result<()> {
    let expected = chain.block.map(|x| x.hash());
    let actual = message.header.prev_block_hash();

    if actual != expected {
        bail!("Previous block hash mismatch: expected {expected:?}, got {actual:?}");
    }

    Ok(())
}

fn validate_block_signatures(chain: &Checkpoint, message: &RelayBlockMessage) -> Result<()> {
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
const METADATA_DESTINATION: &str = "destination";

fn process_transactions(host: &Iroha, config: &Config, message: &RelayBlockMessage) -> Result<()> {
    let block_merkle_root = message
        .header
        .merkle_root()
        .ok_or_else(|| anyhow!("Block contains no transactions"))?;

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

        match &config.mode {
            OperationMode::Hub {
                domestic_chain: other_chain,
                approved_transfers_addr,
            } => handle_tx_hub(tx, other_chain, approved_transfers_addr, host, config)?,
            OperationMode::Domestic { chain } => handle_tx_domestic(tx, chain, host, config)?,
        }
    }

    Ok(())
}

fn handle_tx_hub(
    tx: &CommittedTransaction,
    other_chain: &ChainId,
    approved_transfers_addr: &KeyValueAddress<HubChainTransferPayload>,
    host: &Iroha,
    config: &Config,
) -> Result<()> {
    if let TransactionEntrypoint::External(tx) = tx.entrypoint()
        && let Executable::Instructions(instructions) = tx.instructions()
        && let [InstructionBox::Transfer(TransferBox::Asset(transfer))] =
            instructions.iter().as_slice()
    {
        // Detect transfer from a user account to an omnibus account
        // Detect destination account in metadata

        let None = config.chain_by_omnibus_account(transfer.source().account()) else {
            debug!("ignoring, source account is omnibus");
            return Ok(());
        };
        let Some(destination_chain) = config.chain_by_omnibus_account(transfer.destination())
        else {
            debug!("ignoring, destination account is not omnibus");
            return Ok(());
        };
        let Some(destination_account) = tx
            .metadata()
            .get(METADATA_DESTINATION)
            .map(|json| {
                let str: String = json.try_into_any().with_context(|| "bad json string")?;
                let acc =
                    AccountId::from_str(&str).map_err(|err| anyhow!("bad account id: {err}"))?;
                Ok::<AccountId, anyhow::Error>(acc)
            })
            .transpose()?
        else {
            debug!("ingoring, could not find `{METADATA_DESTINATION}` in metadata");
            return Ok(());
        };

        // Okay - now produce a `SetKeyValue` instruction with the record of the transfer

        let hub_transfer = HubChainTransferPayload {
            source_chain: other_chain.to_owned(),
            source_account: transfer.source().account().to_owned(),
            destination_chain: destination_chain.to_owned(),
            destination_account,
            asset: transfer.source().definition().to_owned(),
            object: transfer.object().to_owned(),
        };

        approved_transfers_addr.write(&host, &hub_transfer)?;
    }

    Ok(())
}

fn handle_tx_domestic(
    _tx: &CommittedTransaction,
    _chain: &ChainId,
    _host: &Iroha,
    _config: &Config,
) -> Result<()> {
    // TODO: extract SetKeyValue instructions produced by the trigger on the hub chain
    Ok(())
}
