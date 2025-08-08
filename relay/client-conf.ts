// NOTE: this is small tool to convert a `relay.json` into `client.toml` for `iroha` CLI
// Usage:
//   `cat config/*relay.json | deno run relay/client-conf.ts > client.toml`

import * as TOML from "@std/toml";
import { RelayConfigSchema } from "../shared.ts";

const decoder = new TextDecoder();
for await (const chunk of Deno.stdin.readable) {
  const text = decoder.decode(chunk);
  const json = JSON.parse(text);
  const config = RelayConfigSchema.parse(json);
  console.log(TOML.stringify({
    chain: config.domesticChainId,
    torii_url: config.domesticToriiUrl,
    account: {
      domain: config.authority.domain.value,
      public_key: config.authority.signatory.multihash(),
      private_key: config.authorityPrivateKey.multihash(),
    },
  }));
}
