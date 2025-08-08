import { Client } from "@iroha/client";
import { blockHash } from "@iroha/core";
import * as iroha from "@iroha/core/data-model";
import { assert } from "@std/assert";
import { delay } from "@std/async";
import Debug from "debug";
import * as tm from "true-myth";
import { match, P } from "ts-pattern";
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

while (true) {
  await tm.task.safelyTry(async () => {
    const events = await clients.domestic.events({
      filters: [iroha.EventFilterBox.Pipeline.Block({
        status: iroha.BlockStatus.Applied,
        height: null,
      })],
    });

    events.ee.on("event", async (event) => {
      dbg("event", event);
      assert(
        event.kind === "Pipeline" && event.value.kind === "Block" && event.value.value.status.kind === "Applied",
        "Bad filter",
      );
      const height = event.value.value.header.height.value;
      const hash = blockHash(event.value.value.header);
      dbg("New block found", height, hash);

      const block = await clients.domestic.find.blocks()
        .filterWith(block => iroha.CompoundPredicate.Atom(block.header.hash.equals(hash)))
        .executeSingle();

      for (const transfer of findTransfers(block)) {
        dbg("submitting transaction on hub chain...");
        (await forwardTransferToHub(transfer)).mapOrElse((err) => {
          dbg("transfer err", err);
        }, () => {
          dbg("transfer is made on the hub chain");
        });
      }
    });

    await events.ee.once("close");
    dbg("Events stream closed, try again");
  }).orElse((err) => {
    dbg("Failed to connect, try again", err);
    return tm.task.fromPromise(delay(2000));
  });
}

type Transfer = {
  destination: iroha.MapEntry<iroha.Name, iroha.Json>;
  transfer: iroha.Transfer<iroha.AssetId, iroha.Numeric, iroha.AccountId>;
};

function findTransfers(
  block: iroha.SignedBlock,
): Transfer[] {
  const errors = new Set(block.value.errors.map(x => Number(x.index)));

  return block.value.payload.transactions
    .filter((_tx, index) => !errors.has(index))
    .flatMap((
      transaction,
    ) =>
      match(transaction)
        .returnType<tm.Maybe<Transfer>>()
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
        .otherwise(() => tm.maybe.nothing())
        .mapOr([], (x) => [x])
    );
}

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
