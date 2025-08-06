import { AccountId, PrivateKey } from "@iroha/core/data-model";
import { z } from "zod";

const AccountSchema = z.string().transform(x => AccountId.parse(x));
const PrivKeySchema = z.string().transform(x => PrivateKey.fromMultihash(x));

export const Config = z.object({
  authority: AccountSchema,
  authorityPrivateKey: PrivKeySchema,
  chains: z.record(
    z.string(),
    z.object({
      toriiUrl: z.url(),
    }),
  ),
});
