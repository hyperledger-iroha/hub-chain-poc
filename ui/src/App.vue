<script setup lang="ts">
import { computed } from "vue";
import Chain from "./components/Chain.vue";
import TransferForm from "./components/TransferForm.vue";
import state, { domesticChains, transferrableAssets } from "./state";

const chainsSorted = computed(() => state.chains.toSorted(x => x.chain === "HUB" ? 10 : 0));
</script>

<template>
  <div class="p-4 flex flex-col items-center gap-4">
    <div class="flex flex-wrap justify-center gap-4">
      <Chain
        v-for="x in chainsSorted"
        :chain="x.chain"
      />
    </div>

    <TransferForm
      :chains="domesticChains()"
      :assets="transferrableAssets()"
      class="w-80"
    />
  </div>
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: monospace;
}
</style>
