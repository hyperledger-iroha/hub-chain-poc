<script lang="ts" setup>
import type { Metadata } from "@iroha/core/data-model";
import { JsonViewer } from "vue3-json-viewer";
import "vue3-json-viewer/dist/vue3-json-viewer.css";

const props = defineProps<{
  metadata: Metadata;
}>();
</script>

<template>
  <table v-if="metadata.length">
    <caption>Metadata</caption>
    <thead>
      <th class="">Key</th>
      <th>Value</th>
    </thead>
    <tbody>
      <tr v-for="({ key, value }) in metadata">
        <td class="text-center">{{ key.value }}</td>
        <td class="bg-gray">
          <JsonViewer :value="value.asValue()" theme="light" />
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style lang="scss" scoped>
td :deep(.jv-code) {
  padding: 0.5rem;
}
</style>
