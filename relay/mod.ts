import { Client, SetupEventsReturn } from "@iroha/client";
import { blockHash } from "@iroha/core";
import * as iroha from "@iroha/core/data-model";
import { assert } from "@std/assert";
import { delay } from "@std/async";
import Debug from "debug";
import * as tm from "true-myth";
import { match, P } from "ts-pattern";
import { z } from "zod";
import { RelayConfigSchema } from "../shared.ts";

const dbg = Debug("relay");

const configPath = Deno.env.get("RELAY_CONFIG");
assert(configPath, "Set config to RELAY_CONFIG");

dbg("Loading config from", configPath);
const config = await Deno.readTextFile(configPath).then(text => RelayConfigSchema.parse(JSON.parse(text)));

const clients = {
  domestic: new Client({
    toriiBaseURL: new URL(config.domesticToriiUrl),
    chain: config.domesticChainId,
    authority: config.authority,
    authorityPrivateKey: config.authorityPrivateKey,
  }),
  hub: new Client({
    toriiBaseURL: new URL(config.hubToriiUrl),
    chain: config.hubChainId,
    authority: config.authority,
    authorityPrivateKey: config.authorityPrivateKey,
  }),
};

await Promise.all([listenDomestic(), listenHub()]);

async function listenDomestic() {
  for await (const tx of interceptTransactions(clients.domestic)) {
    const transfer = findTransfer(tx);
    if (transfer.isJust) {
      dbg("submitting transaction on hub chain...");
      (await forwardTransferToHub(transfer.value))
        .mapOrElse((err) => {
          dbg("transfer err", err);
        }, () => {
          dbg("transfer is made on the hub chain");
        });
    }
  }
}

// FIXME: should forward omnibus account transfers
async function listenHub() {
  for await (const tx of interceptTransactions(clients.hub)) {
    const transfer = findTransfer(tx);
    if (transfer.isJust) {
      dbg("submitting transaction on domestic chain...");
      (await forwardTransferToDomestic(transfer.value))
        .mapOrElse((err) => {
          dbg("transfer err", err);
        }, () => {
          dbg("transfer is made on the  domestic chain");
        });
    }
  }
}

type Transfer = {
  destination: iroha.MapEntry<iroha.Name, iroha.Json>;
  transfer: iroha.Transfer<iroha.AssetId, iroha.Numeric, iroha.AccountId>;
};

async function* eventsGenerator(events: SetupEventsReturn) {
  while (true) {
    const event = await Promise.race([
      events.ee.once("event").then(x => tm.result.ok(x)),
      events.ee.once("close").then(() => tm.result.err(null)),
    ]);

    if (event.isOk) yield event.value;
    return;
  }
}

async function* interceptTransactions(client: Client): AsyncGenerator<iroha.SignedTransaction> {
  while (true) {
    try {
      const events = await client.events({
        filters: [iroha.EventFilterBox.Pipeline.Block({
          status: iroha.BlockStatus.Applied,
          height: null,
        })],
      });

      for await (const event of eventsGenerator(events)) {
        assert(
          event.kind === "Pipeline" && event.value.kind === "Block" && event.value.value.status.kind === "Applied",
          "Bad filter",
        );
        const hash = blockHash(event.value.value.header);

        const block = await client.find.blocks()
          .filterWith(block => iroha.CompoundPredicate.Atom(block.header.hash.equals(hash)))
          .executeSingle();

        const errors = new Set(block.value.errors.map(x => Number(x.index)));

        for (const tx of block.value.payload.transactions.filter((_tx, i) => !errors.has(i))) {
          yield tx;
        }
      }

      dbg("Events stream closed, try again");
    } catch (err) {
      dbg("Failed to connect, try again", err);
      await delay(2000);
    }
  }
}

function findTransfer(
  tx: iroha.SignedTransaction,
): tm.Maybe<Transfer> {
  return match(tx)
    .with({
      value: {
        payload: {
          instructions: {
            kind: "Instructions",
            value: [{ kind: "Transfer", value: { kind: "Asset", value: P.select("transfer") } }],
          },
          metadata: [P.select("destination", { key: { value: "destination" } })],
        },
      },
    }, (found) => tm.maybe.just(found as Transfer))
    .otherwise(() => tm.maybe.nothing());
}

/**
 * Forward a transfer that happened on the domestic, _source_ chain:
 *
 * - From user account
 * - To target chain omnibus account
 * - With destination account on the target chain in metadata
 *
 * as a transfer on the hub chain:
 *
 * - From domestic chain omnibus account
 * - To target chain omnibus account
 * - With the same metadata
 */
function forwardTransferToHub({ transfer, destination }: Transfer): tm.Task<void, unknown> {
  return tm.task.safelyTry(() =>
    clients.hub.transaction(
      iroha.Executable.Instructions([iroha.InstructionBox.Transfer.Asset({
        object: transfer.object,
        source: new iroha.AssetId(config.domesticOmnibusAccount, transfer.source.definition),
        destination: transfer.destination,
      })]),
      { metadata: [destination] },
    ).submit({ verify: true })
  );
}

/**
 * Forward a transfer that happened on the hub chain:
 *
 * - From the source chain omnibus account
 * - To domestic chain omnibus account
 * - With destination account on the domestic chain in metadata
 *
 * as a transfer on the domestic, _target_ chain:
 *
 * - From the source chain omnibus account
 * - To the destination account
 */
function forwardTransferToDomestic({ transfer, destination }: Transfer): tm.Task<void, unknown> {
  return tm.task.safelyTry(() =>
    clients.domestic.transaction(
      iroha.Executable.Instructions([iroha.InstructionBox.Transfer.Asset({
        object: transfer.object,
        source: transfer.source,
        destination: iroha.AccountId.parse(z.string().parse(destination.value.asValue())),
      })]),
    ).submit({ verify: true })
  );
}
