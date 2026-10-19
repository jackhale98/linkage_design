<script lang="ts">
  import type { PointFreedom } from '../../core/math/freedom';
  import { worldToScreen, type Size, type View } from '../lib/view';

  type Vec = [number, number];

  /** Arrows showing how under-constrained points can still move. */
  let {
    view,
    size,
    points,
    tone = 'under',
  }: {
    view: View;
    size: Size;
    points: ({ id: string; at: Vec } & PointFreedom)[];
    /** 'under': sketch freedom (blue); 'over': unwanted mechanism freedom (error colour). */
    tone?: 'under' | 'over';
  } = $props();

  const R = 26; // arrow length from the point, in pixels
  const H = 6; // arrowhead size

  function arrow(c: Vec, u: Vec): string {
    // From the point outwards along u (screen), with a head at the end.
    const t: Vec = [c[0] + u[0] * R, c[1] + u[1] * R];
    const s: Vec = [c[0] + u[0] * 8, c[1] + u[1] * 8];
    const n: Vec = [-u[1], u[0]];
    return `M${s[0]} ${s[1]}L${t[0]} ${t[1]}M${t[0] - u[0] * H + n[0] * H} ${t[1] - u[1] * H + n[1] * H}L${t[0]} ${t[1]}L${t[0] - u[0] * H - n[0] * H} ${t[1] - u[1] * H - n[1] * H}`;
  }

  const marks = $derived(
    points.map((p) => {
      const c = worldToScreen(view, size, p.at[0], p.at[1]);
      const u: Vec = [p.dir[0], -p.dir[1]]; // screen y points down
      const dirs: Vec[] = [u, [-u[0], -u[1]]];
      if (p.kind === 'plane') dirs.push([-u[1], u[0]], [u[1], -u[0]]);
      return { id: p.id, d: dirs.map((v) => arrow(c, v)).join('') };
    }),
  );
</script>

<g class="freedom {tone}" aria-hidden="true">
  {#each marks as m (m.id)}
    <path d={m.d} class="halo" />
    <path d={m.d} class="mark" />
  {/each}
</g>

<style>
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .halo {
    stroke: var(--canvas-bg);
    stroke-width: 6;
  }

  .mark {
    stroke: var(--geom-under);
    stroke-width: 2.5;
  }

  .over .mark {
    stroke: var(--geom-over);
  }
</style>
