<script lang="ts">
  import Icon from './Icon.svelte';
  import { profileDxf, profileSvg, profileTable, svajTable } from '../../core/cam/export';
  import { isOscillating, isRoller } from '../../core/cam/types';
  import { BOM, stringifyCsv } from '../../core/csv/rfc4180';
  import { projectFileName } from '../../core/model/project';
  import { downloadText } from '../lib/files';
  import { formatValue as fmt } from '../lib/format';
  import { emptyCam } from '../../core/cam/types';
  import { store } from '../state/project.svelte';
  import { camUi } from '../state/cam.svelte';

  const cam = $derived(camUi.cam ?? emptyCam());
  const a = $derived(camUi.analysis);
  const sm = $derived(a.summary);
  const L = $derived(store.project.meta.length_unit);
  const F = $derived(store.project.meta.force_unit);
  const S = $derived(isOscillating(cam.follower) ? '°' : ` ${L}`);
  const u = $derived({ length: L, force: F });
  const loaded = $derived(cam.mass > 0 || cam.springRate > 0 || cam.preload !== 0 || cam.load !== 0);
  const lawIssues = $derived(a.issues.filter((i) => /jumps at/.test(i.message)));
  const deg = (v: number) => `${fmt(v)}°`;
  const name = (suffix: string, ext = 'csv') =>
    projectFileName(store.project, suffix).replace(/\.csv$/, `.${ext}`);

  type Check = { ok: 'pass' | 'warn' | 'fail'; title: string; text: string };
  const checks = $derived.by((): Check[] => {
    const out: Check[] = [];
    out.push(
      lawIssues.length
        ? {
            ok: lawIssues.some((i) => i.severity === 'error') ? 'fail' : 'warn',
            title: 'Fundamental law',
            text: lawIssues.map((i) => i.message).join(' · '),
          }
        : {
            ok: 'pass',
            title: 'Fundamental law',
            text: 'Displacement, velocity and acceleration are continuous everywhere (finite jerk).',
          },
    );
    out.push({
      ok: sm.maxPressure.value > cam.pressureLimit ? 'warn' : 'pass',
      title: 'Pressure angle',
      text: `Peaks at ${deg(sm.maxPressure.value)} at ${deg(sm.maxPressure.at)} (limit ${deg(cam.pressureLimit)}).`,
    });
    out.push(
      sm.undercut.length
        ? {
            ok: 'fail',
            title: 'Undercut',
            text: `The profile can't be followed near ${sm.undercut.map(deg).join(', ')}.`,
          }
        : {
            ok: 'pass',
            title: 'Curvature',
            text: isRoller(cam.follower)
              ? `Sharpest convex pitch radius ${fmt(sm.minRhoPitch?.value ?? Infinity)} ${L} at ${deg(sm.minRhoPitch?.at ?? 0)}, larger than the ${fmt(cam.rollerRadius)} ${L} roller.`
              : `No cusps: the smallest surface radius is ${fmt(sm.minRhoSurface.value)} ${L} at ${deg(sm.minRhoSurface.at)}.`,
          },
    );
    if (loaded)
      out.push(
        sm.jump.length
          ? {
              ok: 'fail',
              title: 'Follower contact',
              text: `The follower leaves the cam near ${sm.jump.map(deg).join(', ')}.`,
            }
          : {
              ok: 'pass',
              title: 'Follower contact',
              text: `Contact force stays between ${fmt(sm.force.min)} and ${fmt(sm.force.max)} ${F}.`,
            },
      );
    return out;
  });

  function download(kind: 'svaj' | 'profile' | 'dxf' | 'svg') {
    if (kind === 'svaj') downloadText(name('_cam_svaj'), BOM + stringifyCsv(svajTable(cam, a, u)));
    else if (kind === 'profile')
      downloadText(name('_cam_profile'), BOM + stringifyCsv(profileTable(cam, a, u)));
    else if (kind === 'dxf') downloadText(name('_cam', 'dxf'), profileDxf(a), 'application/dxf');
    else downloadText(name('_cam', 'svg'), profileSvg(cam, a, u), 'image/svg+xml');
  }
</script>

{#if !a.ok}
  <p class="empty">
    {a.issues.find((i) => i.severity === 'error')?.message ??
      'Results appear here once the cam is defined: checks, peak values and profile exports.'}
  </p>
{:else}
  <div class="results">
    <section class="card wide">
      <h3>Checks</h3>
      <ul class="checks">
        {#each checks as c (c.title)}
          <li class={c.ok}>
            <Icon name={c.ok === 'pass' ? 'check' : 'alert'} size={15} />
            <span><strong>{c.title}.</strong> {c.text}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="card">
      <h3>Follower</h3>
      <p class="big num">{fmt(sm.lift)}{S} total lift</p>
      <p class="muted">
        One revolution takes {fmt(60 / Math.max(cam.speed, 1e-9))} s at {fmt(cam.speed)} rpm.
      </p>
      {#if sm.faceWidth}
        <p class="muted">
          Face contact runs from {fmt(sm.faceWidth.min)} to {fmt(sm.faceWidth.max)}
          {L}: the face needs at least {fmt(sm.faceWidth.max - sm.faceWidth.min)}
          {L} plus a margin.
        </p>
      {/if}
    </section>

    {#if loaded}
      <section class="card">
        <h3>Forces</h3>
        <p class="big num">{fmt(sm.torque.min)} to {fmt(sm.torque.max)} {F}·{L}</p>
        <p class="muted">Cam shaft torque. Contact force {fmt(sm.force.min)} to {fmt(sm.force.max)} {F}.</p>
      </section>
    {/if}

    <section class="card export">
      <h3>Export</h3>
      <p class="muted small">
        Profiles are in the cam's own frame at 0°, centred on the cam axis, in {L}, one point every
        {fmt(cam.step)}°.
      </p>
      <div class="buttons">
        <button class="btn primary" onclick={() => download('svaj')}><Icon name="download" /> SVAJ CSV</button
        >
        <button class="btn outline" onclick={() => download('profile')}
          ><Icon name="download" /> Profile CSV</button
        >
        <button class="btn outline" onclick={() => download('dxf')}><Icon name="download" /> DXF</button>
        <button class="btn outline" onclick={() => download('svg')}><Icon name="download" /> SVG</button>
      </div>
    </section>
  </div>
{/if}

<style>
  .empty {
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-3);
    align-items: start;
  }

  .card {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
  }

  .wide {
    grid-column: span 2;
  }

  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
  }

  .big {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .small {
    font-size: var(--text-sm);
  }

  .checks {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .checks li {
    display: flex;
    gap: var(--space-2);
  }

  .checks li :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .checks .pass :global(svg) {
    color: var(--success);
  }

  .checks .warn :global(svg) {
    color: var(--warning);
  }

  .checks .fail :global(svg) {
    color: var(--danger);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  @media (max-width: 900px) {
    .wide {
      grid-column: auto;
    }
  }
</style>
