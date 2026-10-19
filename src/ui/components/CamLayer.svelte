<script lang="ts">
  import { followerPose, type CamAnalysis } from '../../core/cam/analysis';
  import { isRoller, type CamData } from '../../core/cam/types';
  import { worldToScreen, type Size, type View } from '../lib/view';

  type Vec = [number, number];

  let {
    view,
    size,
    cam,
    analysis,
    index,
  }: { view: View; size: Size; cam: CamData; analysis: CamAnalysis; index: number } = $props();

  const S = (p: Vec): Vec => worldToScreen(view, size, p[0], p[1]);
  const sigma = $derived(cam.rotation === 'ccw' ? 1 : -1);
  const sample = $derived(analysis.samples[index] ?? analysis.samples[0]);
  const angle = $derived(sample?.angle ?? 0);
  const th = $derived(((sigma * angle) / 180) * Math.PI);
  const toGround = (p: Vec): Vec => [
    Math.cos(th) * p[0] - Math.sin(th) * p[1],
    Math.sin(th) * p[0] + Math.cos(th) * p[1],
  ];
  const path = (pts: Vec[]) =>
    pts.length ? 'M' + pts.map((p) => S(toGround(p)).join(' ')).join('L') + 'Z' : '';

  const surface = $derived(path(analysis.samples.map((x) => x.surface)));
  const pitch = $derived(isRoller(cam.follower) ? path(analysis.samples.map((x) => x.pitch)) : '');
  const centre = $derived(S([0, 0]));
  const r = $derived(view.scale);
  // Undercut stretches of the surface.
  const undercut = $derived.by(() => {
    const rr = isRoller(cam.follower) ? cam.rollerRadius : 0;
    const bad = analysis.samples.map((x) =>
      isRoller(cam.follower) ? x.rhoPitch > 0 && x.rhoPitch < rr : x.rhoSurface < 0,
    );
    const runs: string[] = [];
    let cur: Vec[] = [];
    analysis.samples.forEach((x, i) => {
      if (bad[i]) cur.push(x.surface);
      else if (cur.length) {
        runs.push('M' + cur.map((p) => S(toGround(p)).join(' ')).join('L'));
        cur = [];
      }
    });
    if (cur.length) runs.push('M' + cur.map((p) => S(toGround(p)).join(' ')).join('L'));
    return runs;
  });

  const pose = $derived(followerPose(cam, analysis.program, angle));
  const contact = $derived(sample ? S(toGround(sample.surface)) : null);
  const reach = $derived(cam.baseRadius + Math.max(0, analysis.summary.lift) + cam.rollerRadius);
</script>

{#if analysis.ok && sample}
  <g class="cam">
    <circle cx={centre[0]} cy={centre[1]} r={cam.baseRadius * r} class="base" />
    <path d={surface} class="body" />
    {#each undercut as d, i (i)}<path {d} class="undercut" />{/each}
    {#if pitch}<path d={pitch} class="pitch" />{/if}
    <!-- A radial mark shows the cam turning. -->
    <line
      x1={centre[0]}
      y1={centre[1]}
      x2={S(toGround([cam.baseRadius * 0.8, 0]))[0]}
      y2={S(toGround([cam.baseRadius * 0.8, 0]))[1]}
      class="mark"
    />
    <circle cx={centre[0]} cy={centre[1]} r="5" class="shaft" />

    {#if pose}
      {#if pose.centre}
        {@const c = S(pose.centre)}
        {#if pose.pivot}
          {@const a = S(pose.pivot)}
          <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} class="arm" />
          <circle cx={a[0]} cy={a[1]} r="5" class="pivot" />
        {:else}
          {@const top = S([pose.centre[0], pose.centre[1] + reach * 0.9])}
          <line x1={c[0]} y1={c[1]} x2={top[0]} y2={top[1]} class="arm" />
        {/if}
        {#if cam.rollerRadius > 0}
          <circle cx={c[0]} cy={c[1]} r={cam.rollerRadius * r} class="roller" />
        {/if}
        <circle cx={c[0]} cy={c[1]} r="3" class="pin" />
      {:else if pose.normalAngle !== undefined && pose.support !== undefined}
        {@const na = pose.normalAngle}
        {@const m = [Math.cos(na), Math.sin(na)] as Vec}
        {@const u = [-Math.sin(na), Math.cos(na)] as Vec}
        {@const foot = [m[0] * pose.support, m[1] * pose.support] as Vec}
        <!-- The face spans the contact positions over a revolution, plus a margin. -->
        {@const fw = analysis.summary.faceWidth ?? { min: -cam.baseRadius / 2, max: cam.baseRadius / 2 }}
        {@const margin = cam.baseRadius * 0.15}
        {#if pose.pivot}
          {@const a = pose.pivot}
          {@const lo = Math.min(fw.min - margin, 0)}
          {@const hi = Math.max(fw.max + margin, 0)}
          {@const e1 = [a[0] + u[0] * lo, a[1] + u[1] * lo] as Vec}
          {@const e2 = [a[0] + u[0] * hi, a[1] + u[1] * hi] as Vec}
          <line x1={S(e1)[0]} y1={S(e1)[1]} x2={S(e2)[0]} y2={S(e2)[1]} class="face" />
          <circle cx={S(a)[0]} cy={S(a)[1]} r="5" class="pivot" />
        {:else}
          {@const p1 = [cam.offset + fw.min - margin, foot[1]] as Vec}
          {@const p2 = [cam.offset + fw.max + margin, foot[1]] as Vec}
          {@const stemBase = [cam.offset, pose.support] as Vec}
          {@const stemTop = [cam.offset, pose.support + reach * 0.9] as Vec}
          <line x1={S(p1)[0]} y1={S(p1)[1]} x2={S(p2)[0]} y2={S(p2)[1]} class="face" />
          <line x1={S(stemBase)[0]} y1={S(stemBase)[1]} x2={S(stemTop)[0]} y2={S(stemTop)[1]} class="arm" />
        {/if}
      {/if}
    {/if}

    {#if contact}
      <circle cx={contact[0]} cy={contact[1]} r="4" class="contact" />
    {/if}
  </g>
{/if}

<style>
  .base {
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  .body {
    fill: color-mix(in srgb, var(--series-1) 16%, transparent);
    stroke: var(--series-1);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }

  .undercut {
    fill: none;
    stroke: var(--geom-over);
    stroke-width: 5;
    stroke-linecap: round;
  }

  .pitch {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1;
    stroke-dasharray: 6 4;
  }

  .mark {
    stroke: var(--series-1);
    stroke-width: 1.5;
  }

  .shaft,
  .pivot {
    fill: var(--canvas-bg);
    stroke: var(--text);
    stroke-width: 2;
  }

  .arm {
    stroke: var(--text);
    stroke-width: 6;
    stroke-linecap: round;
    opacity: 0.75;
  }

  .face {
    stroke: var(--text);
    stroke-width: 4;
    stroke-linecap: round;
  }

  .roller {
    fill: var(--canvas-bg);
    stroke: var(--text);
    stroke-width: 2;
  }

  .pin {
    fill: var(--text);
  }

  .contact {
    fill: var(--load-applied);
    stroke: var(--canvas-bg);
    stroke-width: 1.5;
  }
</style>
