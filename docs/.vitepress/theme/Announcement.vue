<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue';

/**
 * A one-line bar above the navbar. Change KEY when the message changes, so
 * people who closed the old one see the new one.
 */
const KEY = 'megh-announcement-mcp-0.7.5';

// Hidden until mounted, so the static HTML and the first render agree.
const show = ref(false);

onMounted(() => {
  try {
    show.value = localStorage.getItem(KEY) !== 'closed';
  } catch {
    show.value = true;
  }
});

watchEffect(() => {
  if (typeof document === 'undefined') return;
  // VitePress pushes the navbar and sidebar down by this much.
  document.documentElement.style.setProperty('--vp-layout-top-height', show.value ? '40px' : '0px');
});

function close() {
  show.value = false;
  try {
    localStorage.setItem(KEY, 'closed');
  } catch {
    // Private mode: it just comes back on the next visit.
  }
}
</script>

<template>
  <div v-if="show" class="megh-announcement" role="region" aria-label="Announcement">
    <span class="text">
      <strong>Coming after v0.7.5:</strong>
      the Megh MCP server<span class="detail"> lets AI assistants read the docs, inspect your app and run the
      generators</span>.
      <a href="/ai/mcp">Learn more →</a>
    </span>
    <button class="close" type="button" aria-label="Close announcement" @click="close">×</button>
  </div>
</template>

<style scoped>
.megh-announcement {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: calc(var(--vp-z-index-nav) + 1);
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 44px 0 16px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 13px;
  line-height: 1.3;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.close {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 18px;
  line-height: 1;
  color: var(--vp-c-text-2);
}

@media (max-width: 767px) {
  .detail {
    display: none;
  }
}

.close:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}
</style>
