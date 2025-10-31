<script lang="ts" setup>
import * as R from "remeda";
import { maybe } from "true-myth";
import { computed } from "vue";
import state from "../state";
import VAccountId from "./VAccountId.vue";
import VMetadata from "./VMetadata.vue";

const props = defineProps<{
  chain: string;
}>();

const chainState = computed(() => state.chains.find(x => x.chain === props.chain)!);
const chainData = computed(() => maybe.of(chainState.value.data.fulfilled?.value));

const domains = computed(() =>
  chainData.value.map((data) => {
    const assetsByAccount = R.pipe(data.assets, R.groupBy(x => x.id.account.toString()));
    const triggersByAccount = R.pipe(data.triggers, R.groupBy(x => x.authority.toString()));
    const accsByDomain = R.pipe(
      data.accounts,
      R.map((acc) => ({
        ...acc,
        assets: assetsByAccount[acc.id.toString()] ?? [],
        triggers: triggersByAccount[acc.id.toString()] ?? [],
      })),
      R.groupBy(x => x.id.domain.value),
    );
    const definitionsByDomain = R.pipe(data.assetDefinitions, R.groupBy(x => x.id.domain.value));
    const domains = R.pipe(
      data.domains,
      R.map((x) => ({
        ...x,
        accounts: accsByDomain[x.id.value] ?? [],
        definitions: definitionsByDomain[x.id.value] ?? [],
      })),
    );

    return domains;
  })
);
</script>

<template>
  <div class="border-2 border-solid border-green px-4">
    <h2 class="mt-0 mb-4 text-center">Chain <i>{{ chain }}</i></h2>

    <template v-if="domains.isJust">
      <section
        v-for="({ metadata, id, accounts }) in domains.value"
        class="w-120 border-2 border-solid border-blue mb-4 px-4"
      >
        <h3>Domain <i>{{ id.value }}</i></h3>

        <VMetadata :metadata />

        <section
          v-for="({ id, metadata, assets, triggers }) in accounts"
          class="border-2 border-solid border-orange mb-4 px-4"
        >
          <h4>Account <VAccountId :id :metadata /></h4>

          <VMetadata :metadata />

          <table v-if="assets.length" class="assets">
            <caption>Assets</caption>
            <thead>
              <tr>
                <th>Definition</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="({ id, value }) in assets">
                <td>{{ id.definition.toString() }}</td>
                <td>{{ String(value.mantissa) }} {{ String(value.scale) }}</td>
              </tr>
            </tbody>
          </table>

          <section v-for="({ id, metadata }) in triggers">
            <h5>Trigger <i>{{ id.value }}</i></h5>

            <VMetadata :metadata class="w-full" />
          </section>
        </section>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
table {
  width: 100%;
}

table.assets {
  td, th {
    text-align: center;
  }
}
</style>
