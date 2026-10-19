<script lang="ts">
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import { LAW_NAMES, MOTION_LAWS, type MotionLaw } from '../../core/cam/laws';
  import {
    FOLLOWER_NAMES,
    FOLLOWER_TYPES,
    SEGMENT_TYPES,
    isOscillating,
    isRoller,
    type FollowerType,
    type SegmentType,
  } from '../../core/cam/types';
  import { massUnit } from '../../core/forces/types';
  import { store } from '../state/project.svelte';
  import { camUi } from '../state/cam.svelte';

  const cam = $derived(store.project.cam);
  const a = $derived(camUi.analysis);
  const L = $derived(store.project.meta.length_unit);
  const F = $derived(store.project.meta.force_unit);
  const M = $derived(massUnit({ length: L, force: F }));
  const osc = $derived(isOscillating(cam.follower));
  const liftUnit = $derived(osc ? '°' : L);
  const total = $derived(cam.segments.reduce((s, x) => s + x.duration, 0));
  const errors = $derived(a.issues.filter((i) => i.severity === 'error'));
  const warnings = $derived(a.issues.filter((i) => i.severity === 'warning'));
  const TYPE_NAMES: Record<SegmentType, string> = { rise: 'Rise', return: 'Return', dwell: 'Dwell' };
</script>

<header>
  <h2>Cam</h2>
  {#if !cam.segments.length}
    <p class="status"><Icon name="info" size={16} /> Start with a motion program.</p>
  {:else if a.ok && !errors.length}
    <p class="status ok">
      <Icon name="check" size={16} />
      {warnings.length
        ? `Works, with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
        : 'All checks pass'}
    </p>
  {/if}
  {#each [...errors, ...warnings] as i, k (k)}
    <p class="issue {i.severity}"><Icon name="alert" size={15} /><span>{i.message}</span></p>
  {/each}
</header>

<section>
  <h3>Follower</h3>
  <label class="field">
    <span>Follower type</span>
    <select
      class="select"
      value={cam.follower}
      onchange={(e) => camUi.set({ follower: e.currentTarget.value as FollowerType })}
    >
      {#each FOLLOWER_TYPES as f (f)}<option value={f}>{FOLLOWER_NAMES[f]}</option>{/each}
    </select>
  </label>
  <div class="grid2">
    <NumberField
      label="Base circle radius"
      unit={L}
      value={cam.baseRadius}
      oncommit={(v) => camUi.set({ baseRadius: v })}
    />
    {#if isRoller(cam.follower)}
      <NumberField
        label="Roller radius"
        unit={L}
        value={cam.rollerRadius}
        oncommit={(v) => camUi.set({ rollerRadius: Math.max(0, v) })}
      />
    {/if}
    {#if !osc}
      <NumberField label="Offset" unit={L} value={cam.offset} oncommit={(v) => camUi.set({ offset: v })} />
    {:else}
      <NumberField
        label="Pivot distance"
        unit={L}
        value={cam.pivotDistance}
        oncommit={(v) => camUi.set({ pivotDistance: v })}
      />
      {#if isRoller(cam.follower)}
        <NumberField
          label="Arm length"
          unit={L}
          value={cam.armLength}
          oncommit={(v) => camUi.set({ armLength: v })}
        />
      {/if}
    {/if}
  </div>
  <div class="seg" role="radiogroup" aria-label="Cam rotation">
    <button
      role="radio"
      aria-checked={cam.rotation === 'ccw'}
      class:on={cam.rotation === 'ccw'}
      onclick={() => camUi.set({ rotation: 'ccw' })}>Counterclockwise</button
    >
    <button
      role="radio"
      aria-checked={cam.rotation === 'cw'}
      class:on={cam.rotation === 'cw'}
      onclick={() => camUi.set({ rotation: 'cw' })}>Clockwise</button
    >
  </div>
  <div class="grid2">
    <NumberField
      label="Speed"
      unit="rpm"
      value={cam.speed}
      oncommit={(v) => camUi.set({ speed: Math.max(0, v) })}
    />
    <NumberField
      label="Pressure angle limit"
      unit="°"
      value={cam.pressureLimit}
      oncommit={(v) => camUi.set({ pressureLimit: Math.min(89, Math.max(1, v)) })}
    />
  </div>
</section>

<section>
  <h3>
    Motion program
    <span class="total" class:bad={cam.segments.length > 0 && Math.abs(total - 360) > 1e-9}
      >{Number(total.toFixed(3))}° of 360°</span
    >
  </h3>
  {#if !cam.segments.length}
    <button class="btn primary" onclick={() => camUi.start()}>Start from dwell, rise, dwell, return</button>
  {/if}
  <ol class="segments">
    {#each cam.segments as s, i (s.id)}
      <li>
        <div class="line">
          <strong>{s.id}</strong>
          <select
            class="select"
            aria-label={`${s.id} type`}
            value={s.type}
            onchange={(e) => camUi.setSegment(s.id, { type: e.currentTarget.value as SegmentType })}
          >
            {#each SEGMENT_TYPES as t (t)}<option value={t}>{TYPE_NAMES[t]}</option>{/each}
          </select>
          <span class="tools">
            <button
              class="btn icon"
              aria-label={`Move ${s.id} up`}
              disabled={i === 0}
              onclick={() => camUi.moveSegment(s.id, -1)}>↑</button
            >
            <button
              class="btn icon"
              aria-label={`Move ${s.id} down`}
              disabled={i === cam.segments.length - 1}
              onclick={() => camUi.moveSegment(s.id, 1)}>↓</button
            >
            <button class="btn icon" aria-label={`Delete ${s.id}`} onclick={() => camUi.removeSegment(s.id)}
              ><Icon name="trash" size={15} /></button
            >
          </span>
        </div>
        <div class="grid2">
          <NumberField
            label={`${s.id} duration`}
            unit="°"
            value={s.duration}
            oncommit={(v) => camUi.setSegment(s.id, { duration: Math.max(0, v) })}
          />
          {#if s.type !== 'dwell'}
            <NumberField
              label={`${s.id} lift`}
              unit={liftUnit}
              value={s.lift}
              oncommit={(v) => camUi.setSegment(s.id, { lift: Math.max(0, v) })}
            />
          {/if}
        </div>
        {#if s.type !== 'dwell'}
          <select
            class="select"
            aria-label={`${s.id} motion law`}
            value={s.law}
            onchange={(e) => camUi.setSegment(s.id, { law: e.currentTarget.value as MotionLaw })}
          >
            {#each MOTION_LAWS as l (l)}<option value={l}>{LAW_NAMES[l]}</option>{/each}
          </select>
        {/if}
      </li>
    {/each}
  </ol>
  <div class="add" role="group" aria-label="Add a segment">
    <button class="btn outline" onclick={() => camUi.addSegment('rise')}>+ Rise</button>
    <button class="btn outline" onclick={() => camUi.addSegment('dwell')}>+ Dwell</button>
    <button class="btn outline" onclick={() => camUi.addSegment('return')}>+ Return</button>
  </div>
</section>

<section>
  <h3>Follower loads</h3>
  <div class="grid2">
    <NumberField
      label={osc ? 'Arm inertia' : 'Follower mass'}
      unit={osc ? `${M}·${L}²` : M}
      value={cam.mass}
      oncommit={(v) => camUi.set({ mass: Math.max(0, v) })}
    />
    <NumberField
      label="Spring rate"
      unit={osc ? `${F}·${L}/rad` : `${F}/${L}`}
      value={cam.springRate}
      oncommit={(v) => camUi.set({ springRate: Math.max(0, v) })}
    />
    <NumberField
      label="Spring preload"
      unit={osc ? `${F}·${L}` : F}
      value={cam.preload}
      oncommit={(v) => camUi.set({ preload: v })}
    />
    <NumberField
      label={osc ? 'External torque' : 'External load'}
      unit={osc ? `${F}·${L}` : F}
      value={cam.load}
      oncommit={(v) => camUi.set({ load: v })}
    />
  </div>
  <p class="muted small">
    Loads press the follower onto the cam. The contact force must stay above zero, or the follower jumps off
    at speed.
  </p>
  <NumberField
    label="Analysis step"
    unit="°"
    value={cam.step}
    oncommit={(v) => camUi.set({ step: Math.min(10, Math.max(0.05, v)) })}
  />
</section>

<style>
  header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .status.ok {
    color: var(--success);
  }

  .issue {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--text-sm);
  }

  .issue.error {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .issue :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  section {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  h3 {
    display: flex;
    justify-content: space-between;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .total {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    text-transform: none;
  }

  .total.bad {
    color: var(--danger);
  }

  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 3px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .seg button {
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    cursor: pointer;
  }

  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px var(--border);
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-3);
  }

  .segments {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .segments li {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .line {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-2);
    align-items: center;
  }

  .tools {
    display: flex;
    gap: 2px;
  }

  .tools .btn {
    width: 28px;
    height: 28px;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-1);
  }

  .add .btn {
    height: 30px;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .small {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
