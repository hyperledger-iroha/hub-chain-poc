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
import invariant from "tiny-invariant";
import { computed } from "vue";
import state, { clientFor } from "../state";
import PromiseState from "./PromiseState.vue";

const props = defineProps<{
  chains: {
    chain: string;
    omnibus: AccountId;
    users: { id: AccountId; alias: string }[];
  }[];
  assets: AssetDefinitionId[];
}>();

const allAccounts = computed(() => props.chains.flatMap(x => x.users.map(y => ({ chain: x.chain, account: y }))));

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
    if (!(state.form.from && state.form.to && state.form.assetId && state.form.quantity)) return null;

    const sourceChain = findChainOfAccount(state.form.from);
    const targetChain = findChainOfAccount(state.form.to);

    const source = new AssetId(
      AccountId.parse(state.form.from),
      AssetDefinitionId.parse(state.form.assetId),
    );
    const object: Numeric = { mantissa: BigInt(state.form.quantity), scale: 0n };
    const destination = props.chains.find(x => x.chain === targetChain)!.omnibus;

    return {
      chain: sourceChain,
      value: { source, object, destination },
      metadata: [{
        key: new Name("destination"),
        value: Json.fromValue(state.form.to),
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
  ).submit({ verify: false });
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
      <span class="bg-yellow-300">
        <label>From:</label>
        <select v-model="state.form.from">
          <option v-for="x in allAccounts" :value="x.account.id.toString()">
            [{{ x.chain }}] {{ x.account.alias }}
          </option>
        </select>
      </span>

      <span class="bg-indigo-300"><label>To:</label>
        <select v-model="state.form.to">
          <option v-for="x in allAccounts" :value="x.account.id.toString()">
            [{{ x.chain }}] {{ x.account.alias }}
          </option>
        </select></span>

      <span class=""><label>Asset:</label>
        <select v-model="state.form.assetId">
          <option v-for="x in assets" :value="x.toString()">
            {{ x.toString() }}
          </option>
        </select></span>

      <span><label>Quantity:</label>
        <input type="number" v-model="state.form.quantity"></span>
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
