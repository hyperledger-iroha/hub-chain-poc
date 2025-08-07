<script setup lang="ts">
import type { PromiseStateAtomic } from "@vue-kakuyaku/core";

defineProps<{
  state: PromiseStateAtomic<unknown>;
}>();
</script>

<template>
  <slot v-if="state.pending" name="pending">
    <span>
      Pending...
    </span>
  </slot>
  <slot
    v-else-if="state.rejected"
    name="rejected"
    :reason="state.rejected.reason"
  >
    <span class="text-red-600">
      Rejected: {{ state.rejected.reason }}
    </span>
  </slot>
</template>
