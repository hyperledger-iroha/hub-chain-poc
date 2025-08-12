<script lang="ts" setup>
import { type AccountId, AssetId, type Metadata } from "@iroha/core/data-model";
import invariant from "tiny-invariant";
import { maybe } from "true-myth";
import { computed } from "vue";
import state from "../state";
import { displayEvent } from "../utils";
import VAccountId from "./VAccountId.vue";
import VNumberChange from "./VNumberChange.vue";

const props = defineProps<{
  chain: string;
}>();

const chainState = computed(() => state.chains.find(x => x.chain === props.chain)!);
const chainData = computed(() => maybe.of(chainState.value.data.fulfilled?.value));
const accounts = computed(() => chainData.value.map(x => x.accounts));

const assetsGrouped = computed(() =>
  chainData.value.map((data) => {
    const assetsMap = new Map(data.assets.map(x => [x.id.toString(), x]));

    return data.assetDefinitions.map(asset => {
      const instances = data.accounts.map(account => {
        const id = new AssetId(account.id, asset.id);
        const quantity = maybe.of(assetsMap.get(id.toString()))
          .mapOr(0, (x) => Number(x.value.mantissa));
        const formMatchFrom = state.form.from === account.id.toString();
        const formMatchTo = state.form.to === account.id.toString();
        const formMatchAsset = state.form.assetId === asset.id.toString();

        return {
          account,
          quantity,
          formMatchFrom,
          formMatchTo,
          formMatchAsset,
        };
      });

      const total = instances.reduce((acc, x) => acc + x.quantity, 0);

      return {
        asset,
        instances,
        total,
      };
    });
  })
);

function accountMeta(account: AccountId): Metadata {
  invariant(accounts.value.isJust);
  return accounts.value.value.find(x => x.id.compare(account) === 0)!.metadata;
}
</script>

<template>
  <div class="border-1 border-solid border-gray-400 p-2">
    <h2 class="mt-0 mb-4 text-center">Chain <i>{{ chain }}</i></h2>

    <div class="flex gap-4">
      <TransitionGroup tag="div" name="log" class="w-60 flex flex-col overflow-auto max-h-40">
        <span v-for="x in chainState.log.value" :key="x.i">
          {{ displayEvent(x.event) }}
        </span>
      </TransitionGroup>

      <template v-if="assetsGrouped.isJust">
        <table class="assets" v-for="group in assetsGrouped.value">
          <caption>Asset <i>{{ group.asset.id.toString() }}</i></caption>

          <thead>
            <tr>
              <th>
                Account
              </th>
              <th>
                Quantity
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="row in group.instances"
              :key="row.account.id.toString()"
              :class="{
                'bg-yellow-300': row.formMatchAsset && row.formMatchFrom,
                'bg-indigo-300': row.formMatchAsset && row.formMatchTo,
              }"
            >
              <td>
                <VAccountId
                  :id="row.account.id"
                  :metadata="accountMeta(row.account.id)"
                />
              </td>
              <td>
                <VNumberChange class="px-2" :value="row.quantity" />
              </td>
            </tr>
          </tbody>

          <tfoot>
            <tr class="bg-gray-200">
              <th scope="row">Total balance</th>
              <td>
                <VNumberChange :value="group.total" />
              </td>
            </tr>
          </tfoot>
        </table>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
table.log {
  width: 230px;
}

table.assets {
  td, th {
    text-align: center;
  }
}

.log {
  &-enter-active {
    transition: all 0.5s ease;
  }

  &-enter-from {
    opacity: 0;
    transform: translateX(-10px);
  }
}
</style>
