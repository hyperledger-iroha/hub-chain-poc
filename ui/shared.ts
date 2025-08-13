// NOTE: This file contains stuff related not only to UI, but also to relay
//       The problem is that Vite won't discover `zod` from outside the `ui` directory
//       Ugly, I know...

import { AccountId, AssetDefinitionId, PrivateKey } from "@iroha/core/data-model";
import { z } from "zod";

const AccountSchema = z.string().transform(x => AccountId.parse(x));
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
  hubToriiUrl: z.url(),
  hubChainId: z.string(),
});
