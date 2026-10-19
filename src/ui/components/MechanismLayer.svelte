<script lang="ts">
  import type { MechanismModel } from '../../core/mechanism/model';
  import { GROUND } from '../../core/mechanism/types';
  import { worldToScreen, type Size, type View } from '../lib/view';

  type Vec = [number, number];

  let {
    view,
    size,
    model,
    pose,
    labels,
    selection = [],
    hover = null,
    traces = [],
    vectors = [],
    loose = [],
  }: {
    view: View;
    size: Size;
    model: MechanismModel;
    pose: Map<string, Vec>;
    labels: Map<string, string>;
    selection?: string[];
    hover?: string | null;
    traces?: { point: string; color: string; path: Vec[] }[];
    vectors?: { point: string; v: Vec; color: string }[];
    /** Links that can still move when they shouldn't (extra degrees of freedom). */
    loose?: string[];
  } = $props();

  const S = (p: Vec): Vec => worldToScreen(view, size, p[0], p[1]);
  const sel = $derived(new Set(selection));
  const looseSet = $derived(new Set(loose));

  function hull(points: Vec[]): Vec[] {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: Vec[] = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
        lower.pop();
      lower.push(p);
    }
    const upper: Vec[] = [];
    for (const p of [...pts].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
        upper.pop();
      upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  const bodies = $derived(
    model.bodies.map((b) => {
      const segs = b.lines.map((l) => {
        const [p1, p2] = model.lineEnds.get(l)!;
        return [S(pose.get(p1)!), S(pose.get(p2)!)] as [Vec, Vec];
      });
      const pts = b.points.map((p) => S(pose.get(p)!));
      const poly = pts.length >= 3 ? hull(pts) : [];
      return { ...b, segs, poly };
    }),
  );

  const groundLines = $derived(
    [...model.groundLines].map((l) => {
      const [p1, p2] = model.lineEnds.get(l)!;
      return [S(pose.get(p1)!), S(pose.get(p2)!)] as [Vec, Vec];
    }),
  );

  const joints = $derived(
    model.joints.map((j) => {
      const at = S(pose.get(j.point)!);
      let angle = 0;
      if (j.line) {
        const [p1, p2] = model.lineEnds.get(j.line)!;
        const a = S(pose.get(p1)!);
        const b = S(pose.get(p2)!);
        angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      }
      return { ...j, at, angle, grounded: j.a === GROUND || j.b === GROUND };
    }),
  );
  const jointPoints = $derived(new Set(model.joints.map((j) => j.point)));
  const groundPivots = $derived([
    ...new Set(joints.filter((j) => j.grounded && j.type === 'revolute').map((j) => j.point)),
  ]);

  const freePoints = $derived(
    model.bodies.flatMap((b) =>
      b.points
        .filter((p) => !jointPoints.has(p) && !model.groundPoints.has(p))
        .map((p) => ({ id: p, at: S(pose.get(p)!), color: b.color })),
    ),
  );

  const actuator = $derived.by(() => {
    const d = model.driver;
    if (d?.type !== 'linear') return null;
    const a = S(pose.get(d.pointA)!);
    const b = S(pose.get(d.pointB)!);
    const mid: Vec = [a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55];
    return { a, b, mid };
  });

  const driverMark = $derived.by(() => {
    const d = model.driver;
    if (d?.type !== 'rotary') return null;
    const body = model.bodies.find((b) => b.id === d.body);
    const pivot = model.joints.find(
      (j) =>
        j.type === 'revolute' &&
        (j.a === d.body || j.b === d.body) &&
        (j.a === d.refBody || j.b === d.refBody),
    );
    if (!body || !pivot) return null;
    return { at: S(pose.get(pivot.point)!), color: body.color };
  });

  const tracePaths = $derived(
    traces.map((t) => ({ ...t, d: t.path.map((p, i) => `${i ? 'L' : 'M'}${S(p).join(' ')}`).join('') })),
  );

  function arrow(from: Vec, to: Vec): string {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len < 2) return '';
    const ux = dx / len;
    const uy = dy / len;
    const h = Math.min(9, len * 0.4);
    return `M${from[0]} ${from[1]}L${to[0]} ${to[1]}M${to[0] - ux * h - uy * h * 0.45} ${to[1] - uy * h + ux * h * 0.45}L${to[0]} ${to[1]}L${to[0] - ux * h + uy * h * 0.45} ${to[1] - uy * h - ux * h * 0.45}`;
  }
</script>

<g class="mech">
  {#each groundLines as [a, b], i (i)}
    <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} class="ground-line" />
  {/each}

  {#each tracePaths as t (t.point)}
    <path d={t.d} class="trace" style:stroke={t.color} />
  {/each}

  {#if actuator}
    <line x1={actuator.a[0]} y1={actuator.a[1]} x2={actuator.b[0]} y2={actuator.b[1]} class="rod" />
    <line x1={actuator.a[0]} y1={actuator.a[1]} x2={actuator.mid[0]} y2={actuator.mid[1]} class="barrel" />
  {/if}

  {#each bodies.filter((b) => looseSet.has(b.id)) as b (b.id)}
    {#each b.segs as [p, q], i (i)}
      <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} class="loose" />
    {/each}
  {/each}

  {#each bodies as b (b.id)}
    <g class="body" class:selected={sel.has(b.id)} class:hover={hover === b.id} data-body={b.id}>
      {#if b.poly.length >= 3}
        <polygon points={b.poly.map((p) => p.join(',')).join(' ')} style:fill={b.color} class="plate" />
      {/if}
      {#each b.segs as [p, q], i (i)}
        {#if sel.has(b.id) || hover === b.id}
          <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} class="halo" />
        {/if}
        <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} class="bar" style:stroke={b.color} />
      {/each}
    </g>
  {/each}

  {#each groundPivots as id (id)}
    {@const at = S(pose.get(id)!)}
    <g class="ground" transform={`translate(${at[0]} ${at[1]})`}>
      <path d="M0 0L-9 13H9Z" />
      <path d="M-12 13H12M-9 13l-4 5M-3 13l-4 5M3 13l-4 5M9 13l-4 5" class="hatch" />
    </g>
  {/each}

  {#if driverMark}
    <g class="driver" transform={`translate(${driverMark.at[0]} ${driverMark.at[1]})`}>
      <path d="M16 0A16 16 0 1 1 11.3 -11.3" />
      <path d="M11.3 -11.3l-1.2 6.2M11.3 -11.3l-6.2 1.2" />
    </g>
  {/if}

  {#if hover && pose.has(hover)}
    {@const at = S(pose.get(hover)!)}
    <circle cx={at[0]} cy={at[1]} r="13" class="hover-ring" />
  {/if}

  {#each joints as j (j.id + j.point + j.b)}
    {#if j.type === 'slider'}
      <rect
        x={j.at[0] - 9}
        y={j.at[1] - 6}
        width="18"
        height="12"
        rx="2"
        class="block"
        transform={`rotate(${j.angle} ${j.at[0]} ${j.at[1]})`}
      />
    {:else if j.type === 'pin_in_slot'}
      <rect
        x={j.at[0] - 10}
        y={j.at[1] - 5.5}
        width="20"
        height="11"
        rx="5.5"
        class="slot"
        transform={`rotate(${j.angle} ${j.at[0]} ${j.at[1]})`}
      />
    {/if}
    <circle
      cx={j.at[0]}
      cy={j.at[1]}
      r={sel.has(j.point) || hover === j.point ? 6 : 4.5}
      class="pin"
      class:selected={sel.has(j.point)}
    />
  {/each}

  {#each freePoints as p (p.id)}
    <circle
      cx={p.at[0]}
      cy={p.at[1]}
      r={sel.has(p.id) || hover === p.id ? 6 : 4}
      class="free"
      class:selected={sel.has(p.id)}
      style:fill={p.color}
    />
  {/each}

  {#each vectors as v (v.point)}
    {@const at = S(pose.get(v.point)!)}
    <path d={arrow(at, [at[0] + v.v[0], at[1] - v.v[1]])} class="vector" style:stroke={v.color} />
  {/each}

  {#each [...labels] as [id, text] (id)}
    {#if pose.has(id) && (jointPoints.has(id) || freePoints.some((p) => p.id === id))}
      {@const at = S(pose.get(id)!)}
      <text x={at[0] + 9} y={at[1] - 9} class="label" class:id={text === id}>{text}</text>
    {/if}
  {/each}
</g>

<style>
  .ground-line {
    stroke: var(--text-faint);
    stroke-width: 1.25;
    stroke-dasharray: 6 4;
  }

  .loose {
    stroke: var(--geom-over);
    stroke-width: 20;
    stroke-linecap: round;
    opacity: 0.3;
  }

  .plate {
    opacity: 0.16;
  }

  .bar {
    stroke-width: 9;
    stroke-linecap: round;
    opacity: 0.92;
  }

  .halo {
    stroke: var(--accent);
    stroke-width: 16;
    stroke-linecap: round;
    opacity: 0.22;
  }

  .body.selected .halo {
    opacity: 0.4;
  }

  .pin {
    fill: var(--canvas-bg);
    stroke: var(--text);
    stroke-width: 1.75;
  }

  .pin.selected,
  .free.selected {
    stroke: var(--accent);
    stroke-width: 2.5;
  }

  .free {
    stroke: var(--canvas-bg);
    stroke-width: 1.5;
  }

  .slot {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }

  .block {
    fill: var(--surface);
    stroke: var(--text);
    stroke-width: 1.5;
  }

  .ground path {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.25;
  }

  .ground .hatch {
    stroke-width: 1;
  }

  .driver path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .barrel {
    stroke: var(--text-muted);
    stroke-width: 12;
    stroke-linecap: round;
    opacity: 0.55;
  }

  .rod {
    stroke: var(--text-muted);
    stroke-width: 4;
    stroke-linecap: round;
  }

  .trace {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    opacity: 0.85;
  }

  .vector {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .hover-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.5;
  }

  .label.id {
    fill: var(--text-faint);
    font-weight: 500;
  }

  .label {
    fill: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--canvas-bg);
    stroke-width: 3px;
  }
</style>
