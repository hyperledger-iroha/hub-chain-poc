import { Client } from "@iroha/client";
import { Account, Asset, AssetDefinitionId } from "@iroha/core/data-model";
import { type PromiseStateAtomic, useParamScope, useTask } from "@vue-kakuyaku/core";
import { match } from "ts-pattern";
import { type Ref, toRef } from "vue";
import CONFIG from "../../config/ui.json" with { type: "json" };
import { Config } from "./shared.ts";

const config = Config.parse(CONFIG);
const chainsArray = Object.entries(config.chains).map(([chain, x]) => ({ chain, ...x }));

export function clientFor(chain: string): Client {
  return new Client({
    chain,
    toriiBaseURL: new URL(config.chains[chain].toriiUrl),
    authority: config.authority,
    authorityPrivateKey: config.authorityPrivateKey,
  });
}

export function transferrableAssets(): AssetDefinitionId[] {
  return config.transferrable;
}

export function domesticChains() {
  return chainsArray.flatMap(x => x.kind === "domestic" ? [x] : []);
}

type ChainData = {
  data: PromiseStateAtomic<{ accounts: Account[]; assets: Asset[] }>;
  reload: () => void;
};

function useChainData(client: Client): ChainData {
  const task = useTask(async () => {
    const [accounts, assets] = await Promise.all([
      client.find.accounts().executeAll(),
      client.find.assets().executeAll(),
    ]);

    return { accounts, assets };
  }, { immediate: true });

  return { data: task.state, reload: task.run };
}

type ChainConnection = {
  // logs: string[];
  connected: Ref<boolean>;
  data: ChainData["data"];
};

function useChainConnection(client: Client): ChainConnection {
  const { data, reload } = useChainData(client);

  const events = useTask(() => client.events(), { immediate: true });

  useParamScope(() => !!events.state.fulfilled, () => {
    const { ee } = events.state.fulfilled!.value;

    console.log("events");

    ee.on("event", (event) => {
      console.log("wtf event!");
      console.debug("event", event);

      match(event)
        .with({ kind: "Pipeline", value: { kind: "Block", value: { status: { kind: "Applied" } } } }, () => {
          reload();
        }).otherwise(() => {
        });
    });
  });

  return {
    connected: toRef(() => !!events.state.fulfilled),
    data,
  };
}

function useState() {
  const chains = Object.keys(config.chains).map((chain) => {
    const client = clientFor(chain);
    const conn = useChainConnection(client);
    return { chain, ...conn };
  });

  return { chains };
}

const state = useState();

export default state;
