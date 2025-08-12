import { Client } from "@iroha/client";
import {
  Account,
  Asset,
  AssetDefinition,
  AssetDefinitionId,
  BlockStatus,
  EventFilterBox,
} from "@iroha/core/data-model";
import { type PromiseStaleState, useParamScope, useStaleState, useTask } from "@vue-kakuyaku/core";
import { useLocalStorage } from "@vueuse/core";
import { match } from "ts-pattern";
import { reactive, type Ref, toRef } from "vue";
import CONFIG from "../../config/ui.json" with { type: "json" };
import { UiConfigSchema } from "../shared.ts";

const config = UiConfigSchema.parse(CONFIG);
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
  data: PromiseStaleState<{ accounts: Account[]; assets: Asset[]; assetDefinitions: AssetDefinition[] }>;
  reload: () => void;
};

function useChainData(client: Client): ChainData {
  const task = useTask(async () => {
    const [accounts, defs, assets] = await Promise.all([
      client.find.accounts().executeAll(),
      client.find.assetsDefinitions().executeAll(),
      client.find.assets().executeAll(),
    ]);

    return { accounts, assets, assetDefinitions: defs };
  }, { immediate: true });

  const stale = useStaleState(task.state);

  return { data: stale, reload: task.run };
}

type ChainConnection = {
  // logs: string[];
  connected: Ref<boolean>;
  data: ChainData["data"];
};

function useChainConnection(client: Client): ChainConnection {
  const { data, reload } = useChainData(client);

  const events = useTask(() =>
    client.events({
      filters: [
        EventFilterBox.Pipeline.Block({ status: BlockStatus.Applied, height: null }),
      ],
    }), { immediate: true });

  useParamScope(() => !!events.state.fulfilled, () => {
    const { ee } = events.state.fulfilled!.value;

    console.log("events");

    ee.on("event", (event) => {
      console.log("event", event);
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
type FormFields = {
  from: string;
  to: string;
  assetId: string;
  quantity: number;
};

function useTransferForm() {
  const form: { [x in keyof FormFields]: FormFields[x] | null } = reactive({
    from: useLocalStorage<null | string>("transfer-from", null),
    to: useLocalStorage<null | string>("transfer-to", null),
    assetId: useLocalStorage<null | string>("transfer-asset-id", null),
    quantity: null,
  });

  return { form };
}

function useState() {
  const chains = Object.keys(config.chains).map((chain) => {
    const client = clientFor(chain);
    const conn = useChainConnection(client);
    return { chain, ...conn };
  });

  const { form } = useTransferForm();

  return { chains, form };
}

const state = useState();

export default state;
