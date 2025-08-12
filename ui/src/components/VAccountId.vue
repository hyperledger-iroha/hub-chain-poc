<script lang="ts" setup>
import type { AccountId, Metadata } from "@iroha/core/data-model";
import { computed } from "vue";

const props = defineProps<{
  id: AccountId;
  metadata: Metadata;
}>();

const alias = computed(() => {
  const value = props.metadata.find(x => x.key.value === "alias")?.value
    ?.asValue();
  if (typeof value === "string") return value;
  return null;
});
</script>

<template>
  <i v-if="id.domain.value === 'genesis'">&lt;genesis&gt;</i>
  <template v-else-if="alias">
    <i>&lt;{{ alias }}&gt;</i>@{{ id.domain.value }}
  </template>
  <template v-else>{{ id.toString() }}</template>
</template>
