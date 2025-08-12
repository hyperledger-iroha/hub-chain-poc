<script setup lang="ts">
import { useDeferredScope } from "@vue-kakuyaku/core";
import { useRafFn, useTimeoutFn } from "@vueuse/core";
import { computed, type Ref, ref, watch } from "vue";

const props = defineProps<{
  value: number;
}>();

const animation = useDeferredScope<
  { display: Ref<number>; change: "pos" | "neg"; blink: Ref<boolean> }
>();

const DURATION_CHANGE = 1500;
const DURATION_BLINK = 2500;

watch(() => props.value, (val, prev) => {
  const diff = val - prev;

  animation.setup(() => {
    const display = ref(val);
    const blink = ref(false);

    const start = performance.now();
    const raf = useRafFn(({ timestamp }) => {
      const x = (timestamp - start) / DURATION_CHANGE;

      if (x < 1) display.value = ~~(prev + diff * x);
      else {
        display.value = val;
        blink.value = true;
        raf.pause();
        dispose.start();
      }
    });
    const dispose = useTimeoutFn(() => animation.dispose(), DURATION_BLINK, {
      immediate: true,
    });

    return { display, blink, change: diff > 0 ? "pos" : "neg" };
  });
});

const display = computed(() => animation.scope.value?.expose.display.value ?? props.value);
const blink = computed<boolean>(() => animation.scope.value?.expose.blink.value ?? false);
const change = computed(() => animation.scope.value?.expose.change);
</script>

<template>
  <span
    :class="{
      'bg-green-700 text-white': change === 'pos',
      'bg-rose-700 text-white': change === 'neg',
      blink,
    }"
  >
    {{ display }}
  </span>
</template>

<style lang="scss" scoped>
@keyframes animation-blink {
  0% {
    opacity: 0;
  }
  50% {
    opacity: 100;
  }
}

.blink {
  animation: 0.3s steps(1, end) infinite animation-blink;
}
</style>
