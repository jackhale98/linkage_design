<script lang="ts" module>
  // 24x24 stroke icons. Each entry is a list of SVG path strings; "c:x,y,r" draws a circle.
  const ICONS = {
    undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
    redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
    open: [
      'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
    ],
    save: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    new: [
      'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z',
      'M14 3v5h5',
      'M12 11v6',
      'M9 14h6',
    ],
    sun: [
      'c:12,12,4',
      'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
    ],
    moon: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
    system: ['M3.5 5h17v11h-17z', 'M8 20h8', 'M12 16v4'],
    select: ['M6 3.5l12.5 7.2-5.6 1.6-2.4 5.6z'],
    pan: ['M12 3v18M3 12h18', 'M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'],
    point: ['c:12,12,3', 'M12 3v4M12 17v4M3 12h4M17 12h4'],
    line: ['M6 18 18 6', 'c:5,19,2', 'c:19,5,2'],
    dimension: ['M4 7v10M20 7v10', 'M4 12h16', 'M7.5 9 4 12l3.5 3M16.5 9l3.5 3-3.5 3'],
    constraint: ['M8 20 14 4', 'M12 20l6-16'],
    body: ['M4 18 10 5l10 9z'],
    joint: ['c:7,17,3', 'c:17,7,3', 'M9.2 14.8l5.6-5.6'],
    driver: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4.5v4h-4'],
    force: ['M4 20 18 6', 'M10 6h8v8'],
    cam: ['M12 3c5 0 8.5 4 8.5 9.2S16.6 21 12 21s-7.5-3.3-7.5-8S7 3 12 3z', 'c:12,12,1.6'],
    zoomIn: ['c:11,11,6.5', 'M20 20l-4.4-4.4', 'M8 11h6M11 8v6'],
    zoomOut: ['c:11,11,6.5', 'M20 20l-4.4-4.4', 'M8 11h6'],
    fit: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
    play: ['M7 4.5v15l12.5-7.5z'],
    pause: ['M8 5v14M16 5v14'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    chevronDown: ['M6 9l6 6 6-6'],
    chevronUp: ['M6 15l6-6 6 6'],
    close: ['M6 6l12 12M18 6 6 18'],
    alert: ['M12 3.5 21.5 20h-19z', 'M12 10v4.5', 'M12 17.2v.1'],
    info: ['c:12,12,9', 'M12 11v5.5', 'M12 7.8v.1'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    code: ['M9 7l-5 5 5 5M15 7l5 5-5 5'],
    panel: ['M3.5 4.5h17v15h-17z', 'M14.5 4.5v15'],
    plot: ['M4 4v16h16', 'M7 15l4-5 3 3 5-7'],
    table: ['M3.5 4.5h17v15h-17z', 'M3.5 9.5h17M3.5 14.5h17M10 4.5v15'],
    results: ['M6 20V11M12 20V5M18 20v-6'],
    messages: ['M4 5h16v11H9l-4 3.5V16H4z'],
    examples: ['M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z'],
    magnet: ['M6 4v7a6 6 0 0 0 12 0V4', 'M6 8h4M14 8h4'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    copy: ['M8 8h11v11H8z', 'M5 15V5h10'],
  } as const;

  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = 18, stroke = 1.75 }: { name: IconName; size?: number; stroke?: number } = $props();
  const parts = $derived(ICONS[name] as readonly string[]);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each parts as d (d)}
    {#if d.startsWith('c:')}
      {@const [cx, cy, r] = d.slice(2).split(',')}
      <circle {cx} {cy} {r} />
    {:else}
      <path {d} />
    {/if}
  {/each}
</svg>
