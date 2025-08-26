<script setup lang="ts">
import { useDeferredScope } from "@vue-kakuyaku/core";
import { useRafFn, useTimeoutFn } from "@vueuse/core";
import { computed, type Ref, ref, watch } from "vue";

const props = defineProps<{
  value: number;
}>();

const DURATION_CHANGE = 1500;
const DURATION_BLINK = 2500;

const animation = useDeferredScope<{
  display: Ref<number>;
  diff: number;
  blink: Ref<boolean>;
}>();

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

    return { display, blink, diff };
  });
});

const display = computed(() => animation.scope.value?.expose.display.value ?? props.value);
const blink = computed<boolean>(() => animation.scope.value?.expose.blink.value ?? false);
const diff = computed(() => animation.scope.value?.expose.diff ?? 0);
</script>

<template>
  <span class="relative">
    <span
      :class="{
        green: diff > 0,
        red: diff < 0,
        blink,
      }"
    >
      {{ display }}
    </span>

    <span
      class="diff"
      :class="{
        green: diff > 0,
        red: diff < 0,
      }"
      v-if="diff !== 0"
    >{{ diff > 0 ? `+${diff}` : diff }}</span>
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

.green {
  color: white;
  background: oklch(52.7% 0.154 150.069);
}

.red {
  color: white;
  background: oklch(51.4% 0.222 16.935);
}

.blink {
  animation: 0.3s steps(1, end) infinite animation-blink;
}

.diff {
  display: block;
  position: absolute;
  top: 0;
  left: 100%;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.23);
  padding: 2px;
  margin: -2px;
}
</style>
