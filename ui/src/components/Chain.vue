<script lang="ts" setup>
import type {
  Account,
  AccountId,
  Asset,
  Metadata,
} from "@iroha/core/data-model";
import VAccountId from "./AccountId.vue";

const props = defineProps<{
  chain: string;
  connected: boolean;
  accounts: null | Account[];
  assets: null | Asset[];
}>();

function accountMeta(account: AccountId): Metadata {
  return props.accounts!.find(x => x.id.compare(account) === 0)!.metadata;
}
</script>

<template>
  <div class="border-1 border-solid border-gray-400 p-2">
    <h2 class="mt-0 mb-4 text-center">Chain <i>{{ chain }}</i></h2>

    <div class="flex gap-2 items-start">
      <table>
        <caption>All accounts</caption>

        <thead>
          <tr>
            <th>
              Account
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="x in accounts" :key="x.id.toString()">
            <td>
              <VAccountId v-bind="x" />
            </td>
          </tr>
        </tbody>
      </table>

      <table class="border-l-solid border-l-1 border-gray-400 pl-2">
        <caption>Assets</caption>

        <thead>
          <tr>
            <th>
              Account
            </th>
            <th>
              Definition
            </th>
            <th>
              Quantity
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="x in assets" :key="x.id.toString()">
            <td>
              <VAccountId
                :id="x.id.account"
                :metadata="accountMeta(x.id.account)"
              />
            </td>
            <td>{{ x.id.definition.toString() }}</td>
            <td>{{ Number(x.value.mantissa) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
td + td, th + th {
  padding-left: 1rem;
}

td {
  text-align: center;
}
</style>
