<script lang="ts" setup>
import { TransactionRejectedError } from "@iroha/client";
import {
  AccountId,
  AssetDefinitionId,
  AssetId,
  Executable,
  InstructionBox,
  Json,
  Metadata,
  Name,
  Numeric,
  Transfer,
} from "@iroha/core/data-model";
import { useTask } from "@vue-kakuyaku/core";
import { useLocalStorage } from "@vueuse/core";
import invariant from "tiny-invariant";
import { computed, reactive } from "vue";
import { clientFor } from "../state";
import PromiseState from "./PromiseState.vue";

const props = defineProps<{
  chains: {
    chain: string;
    omnibus: AccountId;
    users: { id: AccountId; alias: string }[];
  }[];
  assets: AssetDefinitionId[];
}>();

const allAccounts = computed(() =>
  props.chains.flatMap(x => x.users.map(y => ({ chain: x.chain, account: y })))
);

type FormFields = {
  from: string;
  to: string;
  assetId: string;
  quantity: number;
};

const form: { [x in keyof FormFields]: FormFields[x] | null } = reactive({
  from: useLocalStorage<null | string>("transfer-from", null),
  to: useLocalStorage<null | string>("transfer-to", null),
  assetId: useLocalStorage<null | string>("transfer-asset-id", null),
  quantity: null,
});

function findChainOfAccount(account: string): string {
  return props.chains.find(x => x.users.some(y => y.id.toString() === account))!
    .chain;
}

const transfer = computed<
  null | {
    chain: string;
    value: Transfer<AssetId, Numeric, AccountId>;
    metadata: Metadata;
  }
>(
  () => {
    if (!(form.from && form.to && form.assetId && form.quantity)) return null;

    const sourceChain = findChainOfAccount(form.from);
    const targetChain = findChainOfAccount(form.to);

    const source = new AssetId(
      AccountId.parse(form.from),
      AssetDefinitionId.parse(form.assetId),
    );
    const object: Numeric = { mantissa: BigInt(form.quantity), scale: 0n };
    const destination =
      props.chains.find(x => x.chain === targetChain)!.omnibus;

    return {
      chain: sourceChain,
      value: { source, object, destination },
      metadata: [{
        key: new Name("destination"),
        value: Json.fromValue(form.to),
      }],
    };
  },
);

const canSubmit = computed(() => !!transfer.value);

const submit = useTask(async () => {
  const data = transfer.value;
  invariant(data);
  const client = clientFor(data.chain);
  await client.transaction(
    Executable.Instructions([InstructionBox.Transfer.Asset(data.value)]),
    { metadata: data.metadata },
  ).submit({ verify: true });
});

function formatErr(err: unknown) {
  if (err instanceof TransactionRejectedError) {
    return err.reason;
  }
  return err;
}
</script>

<template>
  <div class="border-1 border-solid border-gray-400 p-2 space-y-2">
    <h2 class="mt-0 text-center">Transfer</h2>

    <div class="flex flex-col gap-2 fields">
      <span>
        <label>From:</label>
        <select v-model="form.from">
          <option v-for="x in allAccounts" :value="x.account.id.toString()">
            [{{ x.chain }}] {{ x.account.alias }}
          </option>
        </select>
      </span>

      <span><label>To:</label>
        <select v-model="form.to">
          <option v-for="x in allAccounts" :value="x.account.id.toString()">
            [{{ x.chain }}] {{ x.account.alias }}
          </option>
        </select></span>

      <span><label>Asset:</label>
        <select v-model="form.assetId">
          <option v-for="x in assets" :value="x.toString()">
            {{ x.toString() }}
          </option>
        </select></span>

      <span><label>Quantity:</label>
        <input type="number" v-model="form.quantity"></span>
    </div>
    <button :disabled="!canSubmit" @click="submit.run()">
      Submit
    </button>
    <div>
      <PromiseState :state="submit.state">
        <template #rejected="{ reason }">
          <span class="text-red-600">Rejected: {{ formatErr(reason) }}</span>
        </template>
      </PromiseState>
    </div>
  </div>
</template>

<style scoped>
.fields span {
  display: inline-flex;
  align-items: center;
}

.fields span label {
  flex: 1;
  padding-right: 1rem;
}
</style>
