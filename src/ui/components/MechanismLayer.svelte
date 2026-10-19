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
    camShapes = new Map(),
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
    /** Cam outlines (cam frame) by cam ID, for drawing cam joints. */
    camShapes?: Map<string, Vec[]>;
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

  // ---------------------------------------------------------------- cams and gears

  /** How far a body has turned from the drawn pose (rad), from its first line. */
  function turned(body: string): number {
    if (body === GROUND) return 0;
    const b = model.bodies.find((x) => x.id === body);
    const line = b?.lines[0];
    if (!line) return 0;
    const [p1, p2] = model.lineEnds.get(line)!;
    const a0 = model.positions.get(p1)!;
    const b0 = model.positions.get(p2)!;
    const a1 = pose.get(p1)!;
    const b1 = pose.get(p2)!;
    return Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  }

  /** A gear outline: z simple teeth round the pitch radius r, the first tooth centred at angle a0. */
  function gearPath(c: Vec, r: number, z: number, a0: number): string {
    const m = (2 * r) / z;
    const tip = r + m;
    const root = Math.max(r - 1.25 * m, r * 0.2);
    const step = (2 * Math.PI) / z;
    const at = (rad: number, a: number) => S([c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]);
    const pts: Vec[] = [];
    for (let k = 0; k < z; k++) {
      const t = a0 + k * step;
      pts.push(
        at(root, t - 0.3 * step),
        at(tip, t - 0.14 * step),
        at(tip, t + 0.14 * step),
        at(root, t + 0.3 * step),
      );
    }
    return 'M' + pts.map((p) => p.join(' ')).join('L') + 'Z';
  }

  const bodyColor = (id: string) => model.bodies.find((b) => b.id === id)?.color ?? 'var(--text-faint)';

  type Shape = { key: string; d: string; color: string; open?: boolean; roller?: { at: Vec; r: number } };

  const pairShapes = $derived(
    model.pairs.flatMap((pr): Shape[] => {
      if (pr.type === 'gear') {
        const A0 = model.positions.get(pr.pa)!;
        const B0 = model.positions.get(pr.pb)!;
        const u0 = Math.atan2(B0[1] - A0[1], B0[0] - A0[0]);
        // Teeth start interleaved at the pitch point and stay so as the gears roll.
        return [
          {
            key: `${pr.id}a`,
            d: gearPath(pose.get(pr.pa)!, pr.ra, pr.za, u0 + turned(pr.a)),
            color: bodyColor(pr.a),
          },
          {
            key: `${pr.id}b`,
            d: gearPath(pose.get(pr.pb)!, pr.rb, pr.zb, u0 + Math.PI + Math.PI / pr.zb + turned(pr.b)),
            color: bodyColor(pr.b),
          },
        ];
      }
      if (pr.type === 'rack') {
        const pin = gearPath(pose.get(pr.pa)!, pr.r, pr.za, Math.atan2(pr.n[1], pr.n[0]) + turned(pr.a));
        // Rack teeth, fixed to the rack: spaces at the drawn pitch point, then every circular pitch.
        const [l1, l2] = model.lineEnds.get(pr.line)!;
        const s0 = model.positions.get(l1)!;
        const e0 = model.positions.get(l2)!;
        const len0 = Math.hypot(e0[0] - s0[0], e0[1] - s0[1]) || 1;
        const dir0: Vec = [(e0[0] - s0[0]) / len0, (e0[1] - s0[1]) / len0];
        const s1 = pose.get(l1)!;
        const e1 = pose.get(l2)!;
        const len1 = Math.hypot(e1[0] - s1[0], e1[1] - s1[1]) || 1;
        const dir1: Vec = [(e1[0] - s1[0]) / len1, (e1[1] - s1[1]) / len1];
        const side = -Math.sign(pr.n[0] * -dir0[1] + pr.n[1] * dir0[0]) || 1; // towards the pinion
        const nrm: Vec = [-dir1[1] * side, dir1[0] * side];
        const m = (2 * pr.r) / pr.za;
        const p = Math.PI * m;
        const at0 = (pr.pitch[0] - s0[0]) * dir0[0] + (pr.pitch[1] - s0[1]) * dir0[1];
        const pts: string[] = [];
        for (let k = Math.ceil(-at0 / p - 0.5); (k + 0.5) * p + at0 <= len0; k++) {
          const c = at0 + (k + 0.5) * p;
          if (c < 0) continue;
          const P = (x: number, h: number): Vec => [
            s1[0] + dir1[0] * x + nrm[0] * h,
            s1[1] + dir1[1] * x + nrm[1] * h,
          ];
          const q = [
            P(c - 0.3 * p, -1.25 * m),
            P(c - 0.14 * p, m),
            P(c + 0.14 * p, m),
            P(c + 0.3 * p, -1.25 * m),
          ].map(S);
          pts.push('M' + q.map((v) => v.join(' ')).join('L'));
        }
        return [
          { key: `${pr.id}p`, d: pin, color: bodyColor(pr.a) },
          { key: `${pr.id}r`, d: pts.join(''), color: bodyColor(pr.b), open: true },
        ];
      }
      const shape = camShapes.get(pr.camId);
      if (!shape?.length) return [];
      const O = pose.get(pr.pa)!;
      const beta = pr.alpha + turned(pr.a);
      const c = Math.cos(beta);
      const sn = Math.sin(beta);
      const d =
        'M' +
        shape.map(([x, y]) => S([O[0] + c * x - sn * y, O[1] + sn * x + c * y]).join(' ')).join('L') +
        'Z';
      return [
        {
          key: pr.id,
          d,
          color: bodyColor(pr.a),
          roller: { at: S(pose.get(pr.pb)!), r: pr.curve.rollerRadius * view.scale },
        },
      ];
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

  {#each pairShapes as sh (sh.key)}
    <path
      d={sh.d}
      class="pair"
      class:open={sh.open}
      style:stroke={sh.color}
      style:fill={sh.open ? 'none' : sh.color}
    />
    {#if sh.roller && sh.roller.r > 0}
      <circle cx={sh.roller.at[0]} cy={sh.roller.at[1]} r={sh.roller.r} class="roller" />
    {/if}
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
      data-point={j.point}
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

  .pair {
    fill-opacity: 0.14;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .pair.open {
    stroke-width: 2;
  }

  .roller {
    fill: var(--canvas-bg);
    stroke: var(--text);
    stroke-width: 1.5;
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
