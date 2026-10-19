<script lang="ts">
  let { size = 26 }: { size?: number } = $props();
</script>

<!-- A four-bar linkage: ground pivots, crank, coupler and rocker. -->
<svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="8" fill="var(--accent)" />
  <g
    stroke="var(--accent-text)"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    fill="none"
  >
    <path d="M8 23 11 11 22 9 24 23" />
    <path d="M5 26h22" stroke-width="1.6" opacity="0.7" />
  </g>
  <g fill="var(--accent)" stroke="var(--accent-text)" stroke-width="1.8">
    <circle cx="8" cy="23" r="2.2" />
    <circle cx="11" cy="11" r="2.2" />
    <circle cx="22" cy="9" r="2.2" />
    <circle cx="24" cy="23" r="2.2" />
  </g>
</svg>

<style>
  .logo {
    flex: none;
  }
</style>
