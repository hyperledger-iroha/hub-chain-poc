import { Client } from "@iroha/client";
import * as iroha from "@iroha/core/data-model";
import { assert, fail, unimplemented } from "@std/assert";
import { delay } from "@std/async";
import { pino } from "pino";
import * as tm from "true-myth";
import { match } from "ts-pattern";
import { z } from "zod";
import { BlockMessageSchema, CheckpointSchema, KeyValueAddressSchema, RelayConfigSchema } from "../ui/shared.ts";

type KeyValueAddress = z.output<typeof KeyValueAddressSchema>;
type Checkpoint = z.output<typeof CheckpointSchema>;
type BlockMessage = z.output<typeof BlockMessageSchema>;

const configPath = Deno.env.get("RELAY_CONFIG");
assert(configPath, "Set config path to RELAY_CONFIG");

const log = pino({
  transport: { target: "pino-pretty" },
  base: { config: configPath },
});

log.info("Loading config");
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

await Promise.all([
  loop({
    targetClient: clients.hub,
    targetCheckpoint: createKeyValue(config.hubCheckpoint, CheckpointSchema),
    targetBlockMessage: createKeyValue(config.hubBlockMessage, BlockMessageSchema),
    sourceClient: clients.domestic,
  }),
  // TODO: reverse loop
]);

/**
 * Main relay loop.
 *
 * 1. On the target chain, wait until the checkpoint is synced with the block message
 * 2. On the source chain, wait until the next block on appears
 * 3. Post a new block message to the target chain
 */
async function loop(opts: {
  targetClient: Client;
  targetCheckpoint: KeyValueReadWrite<Checkpoint>;
  targetBlockMessage: KeyValueReadWrite<BlockMessage>;
  sourceClient: Client;
}) {
  const log1 = log.child({});
  while (true) {
    try {
      const checkpoint = (await opts.targetCheckpoint.read(opts.targetClient))
        .unwrapOrElse(() => fail("checkpoint must always exist"));

      const blockMessage = await opts.targetBlockMessage.read(opts.targetClient);

      // TODO: implement
      // compare checkpoint & block message;
      // if checkpoint is sync with the block message, wait for it, restart the loop;
      // wait for the block (on source chain) next to the block message;
      // prepare block message, post to the target chain;
      // ?????
      // PROFIT!!!
    } catch (err) {
      log1.error({ err }, "Loop failed, waiting before retrying");
      await delay(5000);
      continue;
    }

    log1.info("loop finished");
    // TODO: remove the delay, loop can restart immediately and wait for conditions
    await delay(60000);
  }
}

type KeyValueReadWrite<T> = {
  read: (client: Client) => Promise<tm.Maybe<T>>;
  write: (client: Client, value: T) => Promise<void>;
};

function createKeyValue<T extends z.ZodSchema>(addr: KeyValueAddress, schema: T): KeyValueReadWrite<z.output<T>> {
  return {
    read: async (client) => {
      const metadata = await match(addr.entity)
        .returnType<Promise<null | iroha.Metadata>>()
        .with(
          { type: "Domain" },
          ({ id }) =>
            client.find.domains()
              .filterWith((x) => iroha.CompoundPredicate.Atom(x.id.equals(id)))
              .selectWith(x => x.metadata)
              .executeSingleOpt(),
        )
        .with(
          { type: "Account" },
          ({ id }) =>
            client.find.accounts()
              .filterWith((x) => iroha.CompoundPredicate.Atom(x.id.equals(id)))
              .selectWith(x => x.metadata)
              .executeSingleOpt(),
        )
        .with(
          { type: "AssetDefinition" },
          ({ id }) =>
            client.find.assetsDefinitions()
              .filterWith((x) => iroha.CompoundPredicate.Atom(x.id.equals(id)))
              .selectWith(x => x.metadata)
              .executeSingleOpt(),
        )
        .with(
          { type: "Nft" },
          ({ id }) =>
            client.find.nfts()
              .filterWith((x) => iroha.CompoundPredicate.Atom(x.id.equals(id)))
              .selectWith(x => x.metadata)
              .executeSingleOpt(),
        )
        .with(
          { type: "Trigger" },
          ({ id }) =>
            client.find.triggers()
              .filterWith((x) => iroha.CompoundPredicate.Atom(x.id.equals(id)))
              .selectWith(x => x.action.metadata)
              .executeSingleOpt(),
        )
        .exhaustive();

      return tm.maybe.of(metadata)
        .andThen((meta) => tm.maybe.of(meta.find(x => x.key.value === addr.key)))
        .map((entry) => schema.parse(entry.value.asValue()) as z.output<T> & {});
    },
    write: async (client, value) => {
      unimplemented();
    },
  };
}
