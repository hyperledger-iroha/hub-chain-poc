<script setup lang="ts">
import Chain from "./components/Chain.vue";

import state from "./state";
</script>

<template>
  <div class="p-4 flex flex-wrap justify-center gap-4">
    <Chain
      v-for="x in state.chains"
      :chain="x.chain"
      :connected="x.connected.value"
      :accounts="x.data.fulfilled?.value?.accounts ?? null"
      :assets="x.data.fulfilled?.value?.assets ?? null"
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
