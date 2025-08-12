import { Client } from "@iroha/client";
import {
  Account,
  Asset,
  AssetDefinition,
  AssetDefinitionId,
  BlockStatus,
  EventBox,
  EventFilterBox,
} from "@iroha/core/data-model";
import { type PromiseStaleState, useParamScope, useStaleState, useTask } from "@vue-kakuyaku/core";
import { useLocalStorage } from "@vueuse/core";
import RingBuffer from "ringbufferjs";
import { match } from "ts-pattern";
import { computed, reactive, type Ref, toRef } from "vue";
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
  connected: Ref<boolean>;
  data: ChainData["data"];
  log: Ref<Log[]>;
};

type Log = { event: EventBox; i: number };

const LOGS_BUFFER = 50;

function useChainConnection(client: Client): ChainConnection {
  const { data, reload } = useChainData(client);

  const events = useTask(() =>
    client.events({
      filters: [
        EventFilterBox.Pipeline.Block({ status: null, height: null }),
      ],
    }), { immediate: true });

  let logCounter = 0;
  const log = reactive(new RingBuffer<Log>(LOGS_BUFFER));

  useParamScope(() => !!events.state.fulfilled, () => {
    const { ee } = events.state.fulfilled!.value;

    ee.on("event", (event) => {
      console.log("event", event);
      log.enq({ i: logCounter++, event });
      match(event)
        .with({ kind: "Pipeline", value: { kind: "Block", value: { status: { kind: "Applied" } } } }, () => {
          reload();
        }).otherwise(() => {
          // do nothing
        });
    });
  });

  return {
    connected: toRef(() => !!events.state.fulfilled),
    data,
    log: computed(() => log.peekN(log.size()).toReversed()),
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
