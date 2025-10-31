// NOTE: This file contains stuff related not only to UI, but also to relay
//       The problem is that Vite won't discover `zod` from outside the `ui` directory
//       Ugly, I know...

import { AccountId, AssetDefinitionId, Name, NftId, PrivateKey, PublicKey } from "@iroha/core/data-model";
import { z } from "zod";

const AccountSchema = z.codec(
  z.string(),
  z.instanceof(AccountId),
  {
    encode: (x) => x.toString(),
    decode: (x) => AccountId.parse(x),
  },
);
const PrivKeySchema = z.string().transform(x => PrivateKey.fromMultihash(x));
const AssetDefinitionIdSchema = z.string().transform(x => AssetDefinitionId.parse(x));

export const UiConfigSchema = z.object({
  authority: AccountSchema,
  authorityPrivateKey: PrivKeySchema,
  transferrable: z.array(AssetDefinitionIdSchema),
  chains: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("domestic"),
        toriiUrl: z.url(),
        omnibus: AccountSchema,
        users: z.array(z.object({ id: AccountSchema, alias: z.string() })),
      }),
      z.object({ kind: z.literal("hub"), toriiUrl: z.url() }),
    ]),
  ),
});

export const RelayConfigSchema = z.object({
  authority: AccountSchema,
  authorityPrivateKey: PrivKeySchema,
  omnibusAccounts: z.array(AccountSchema),
  domesticChainId: z.string(),
  domesticToriiUrl: z.url(),
  domesticOmnibusAccount: AccountSchema,
  domesticCheckpoint: z.lazy(() => KeyValueAddressSchema),
  domesticBlockMessage: z.lazy(() => KeyValueAddressSchema),
  hubToriiUrl: z.url(),
  hubChainId: z.string(),
  hubCheckpoint: z.lazy(() => KeyValueAddressSchema),
  hubBlockMessage: z.lazy(() => KeyValueAddressSchema),
});

export const KeyValueEntitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Domain"), id: z.string().transform(x => new Name(x)) }),
  z.object({ type: z.literal("Account"), id: AccountSchema }),
  z.object({ type: z.literal("AssetDefinition"), id: AssetDefinitionIdSchema }),
  z.object({ type: z.literal("Nft"), id: z.string().transform(x => NftId.parse(x)) }),
  z.object({ type: z.literal("Trigger"), id: z.string().transform(x => new Name(x)) }),
]);

export const KeyValueAddressSchema = z.object({
  entity: KeyValueEntitySchema,
  key: z.string(),
});

export const TriggerConfigSchema = z.object({
  mode: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("Hub"),
      domestic_chain: z.string(),
      approved_transfers_addr: KeyValueAddressSchema,
    }),
    z.object({
      type: z.literal("Domestic"),
      chain: z.string(),
    }),
  ]),
  checkpoint_addr: KeyValueAddressSchema,
  block_message_addr: KeyValueAddressSchema,
  chains: z.record(z.string(), z.object({ omnibus_account: AccountSchema })),
});

type PubKeyFixed = { new(): PublicKey };

const PublicKeySchema = z.codec(
  z.string(),
  z.instanceof(PublicKey as unknown as PubKeyFixed),
  {
    encode: (key) => key.multihash(),
    decode: (hash) => PublicKey.fromMultihash(hash),
  },
);

export const CheckpointSchema = z.object({
  validators: z.codec(
    z.array(PublicKeySchema.in),
    z.set(PublicKeySchema.out),
    {
      encode: (set) => [...set].map(x => x.multihash()),
      decode: (x) => new Set([...x].map(x => PublicKey.fromMultihash(x))),
    },
  ),
  // there is also "block", but it is only set from within the trigger
});

export const BlockMessageSchema = z.object({
  // TODO
});

export const HubChainTransferPayload = z.object({
  source_chain: z.string(),
  source_account: AccountSchema,
  destination_chain: z.string(),
  destination_account: AccountSchema,
  asset: z.string(),
  object: z.object({ scale: z.number(), mantissa: z.number() }),
});
