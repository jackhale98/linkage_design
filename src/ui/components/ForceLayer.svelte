<script lang="ts">
  import type { ForceOverlay } from '../lib/forceOverlay';
  import { worldToScreen, type Size, type View } from '../lib/view';

  type Vec = [number, number];

  let { view, size, overlay }: { view: View; size: Size; overlay: ForceOverlay } = $props();

  const S = (p: Vec): Vec => worldToScreen(view, size, p[0], p[1]);
  /** Pixels per force unit: the largest force over the sweep draws 90 px long. */
  const k = $derived(90 / overlay.maxForce);

  function arrowPath(from: Vec, d: Vec): string {
    const len = Math.hypot(d[0], d[1]);
    if (len < 1e-9) return '';
    const shown = Math.max(len, 14); // keep tiny forces visible
    const ux = d[0] / len;
    const uy = d[1] / len;
    const to: Vec = [from[0] + ux * shown, from[1] + uy * shown];
    const h = Math.min(9, shown * 0.45);
    return `M${from[0]} ${from[1]}L${to[0]} ${to[1]}M${to[0] - ux * h - uy * h * 0.5} ${to[1] - uy * h + ux * h * 0.5}L${to[0]} ${to[1]}L${to[0] - ux * h + uy * h * 0.5} ${to[1] - uy * h - ux * h * 0.5}`;
  }

  const arrows = $derived(
    overlay.arrows.map((a) => {
      const at = S(a.at);
      // Screen y points down.
      const d: Vec = [a.F[0] * k, -a.F[1] * k];
      const n = Math.hypot(d[0], d[1]);
      const u: Vec = n > 0 ? [d[0] / n, d[1] / n] : [0, 0];
      const len = Math.max(n, 14);
      // Anchor the label beyond the tip so it never runs back over its own arrow.
      const anchor = u[0] > 0.35 ? 'start' : u[0] < -0.35 ? 'end' : 'middle';
      const gap = anchor === 'middle' ? 10 : 6;
      return {
        ...a,
        d: arrowPath(at, d),
        tip: [at[0] + u[0] * (len + gap), at[1] + u[1] * (len + gap)] as Vec,
        anchor,
      };
    }),
  );

  function arc(at: Vec, T: number): { d: string; label: Vec } {
    const r = 22;
    const ccw = T >= 0;
    // A 270-degree arc with an arrowhead showing the turning direction.
    const a0 = Math.PI * 0.25;
    const a1 = a0 + (ccw ? 1.5 : -1.5) * Math.PI;
    const p0: Vec = [at[0] + r * Math.cos(a0), at[1] - r * Math.sin(a0)];
    const p1: Vec = [at[0] + r * Math.cos(a1), at[1] - r * Math.sin(a1)];
    const t: Vec = ccw ? [-Math.sin(a1), -Math.cos(a1)] : [Math.sin(a1), Math.cos(a1)];
    const n: Vec = [-t[1], t[0]];
    const h = 7;
    const head = `M${p1[0] - t[0] * h + n[0] * h * 0.5} ${p1[1] - t[1] * h + n[1] * h * 0.5}L${p1[0]} ${p1[1]}L${p1[0] - t[0] * h - n[0] * h * 0.5} ${p1[1] - t[1] * h - n[1] * h * 0.5}`;
    return {
      d: `M${p0[0]} ${p0[1]}A${r} ${r} 0 1 ${ccw ? 0 : 1} ${p1[0]} ${p1[1]}${head}`,
      label: [at[0] + r + 6, at[1] - r - 4],
    };
  }

  function zigzag(a: Vec, b: Vec): string {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) return '';
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * 6;
    const ny = ux * 6;
    const coils = 10;
    const lead = Math.min(10, len * 0.15);
    let d = `M${a[0]} ${a[1]}L${a[0] + ux * lead} ${a[1] + uy * lead}`;
    for (let i = 0; i <= coils; i++) {
      const t = lead + ((len - 2 * lead) * i) / coils;
      const side = i === 0 || i === coils ? 0 : i % 2 ? 1 : -1;
      d += `L${a[0] + ux * t + nx * side} ${a[1] + uy * t + ny * side}`;
    }
    return d + `L${b[0]} ${b[1]}`;
  }
</script>

<g class="forces">
  {#each overlay.springs as s (s.key)}
    <path d={zigzag(S(s.a), S(s.b))} class="spring" />
  {/each}

  {#each overlay.coms as c, i (i)}
    {@const p = S(c)}
    <g class="com" transform={`translate(${p[0]} ${p[1]})`}>
      <circle r="6" />
      <path d="M0 -6A6 6 0 0 1 6 0H0ZM0 6A6 6 0 0 1 -6 0H0Z" />
    </g>
  {/each}

  {#each arrows as a (a.key)}
    <path d={a.d} class="arrow {a.kind}" />
    {#if a.label}
      <text x={a.tip[0]} y={a.tip[1]} text-anchor={a.anchor} class="label {a.kind}">{a.label}</text>
    {/if}
  {/each}

  {#each overlay.torques as t (t.key)}
    {@const g = arc(S(t.at), t.T)}
    <path d={g.d} class="torque {t.kind}" />
    <text x={g.label[0]} y={g.label[1]} class="label {t.kind}">{t.label}</text>
  {/each}
</g>

<style>
  .arrow {
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .arrow.applied,
  .torque.applied {
    stroke: var(--load-applied);
  }

  .arrow.gravity {
    stroke: var(--load-applied);
    stroke-dasharray: 4 3;
    opacity: 0.8;
  }

  .arrow.reaction {
    stroke: var(--load-reaction);
  }

  .torque {
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .torque.driver {
    stroke: var(--accent);
  }

  .spring {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .com circle {
    fill: var(--canvas-bg);
    stroke: var(--text);
    stroke-width: 1.25;
  }

  .com path {
    fill: var(--text);
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    paint-order: stroke;
    stroke: var(--canvas-bg);
    stroke-width: 3px;
    stroke-linejoin: round;
    dominant-baseline: central;
  }

  .label.applied,
  .label.gravity {
    fill: var(--load-applied);
  }

  .label.reaction {
    fill: var(--load-reaction);
  }

  .label.driver {
    fill: var(--accent);
  }
</style>
