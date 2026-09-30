<script setup lang="ts">
import { gsap } from 'gsap';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const root = ref<HTMLElement | null>(null);
let context: gsap.Context | undefined;
let media: gsap.MatchMedia | undefined;

onMounted(() => {
  if (!root.value) return;
  const element = root.value;
  context = gsap.context(() => {
    media = gsap.matchMedia();
    media.add('(min-width: 901px) and (prefers-reduced-motion: no-preference)', () => {
      const heading = element.querySelector('.page-heading, .detail-hero');
      if (!heading) return;
      gsap.from(heading, {
        y: 14,
        autoAlpha: 0,
        duration: 0.42,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility',
      });
    });
  }, element);
});

onBeforeUnmount(() => {
  media?.revert();
  context?.revert();
});
</script>

<template>
  <div ref="root" class="page-motion-scope"><slot /></div>
</template>
