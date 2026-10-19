<script lang="ts">
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import { GROUND, type PairRecord, type PairType } from '../../core/mechanism/types';
  import { store } from '../state/project.svelte';
  import { motionUi } from '../state/motion.svelte';

  const project = $derived(store.project);
  const pairs = $derived(project.mechanism.pairs);
  const model = $derived(motionUi.result.model);
  const L = $derived(project.meta.length_unit);
  const TYPE: Record<PairType, string> = { cam: 'Cam joint', gear: 'Gear pair', rack: 'Rack and pinion' };

  const bodies = $derived(model.bodies);
  const bodyName = (id: string) => (id === GROUND ? 'Ground' : (bodies.find((b) => b.id === id)?.name ?? id));
  const pointsOf = (id: string) =>
    id === GROUND ? [...model.groundPoints] : (bodies.find((b) => b.id === id)?.points ?? []);
  const linesOf = (id: string) => bodies.find((b) => b.id === id)?.lines ?? [];
  const pointName = (p: string) => model.pointNames.get(p) ?? p;
  const resolved = (id: string) => model.pairs.find((x) => x.id === id);
  const problem = (id: string) =>
    motionUi.result.issues
      .find((i) => i.severity === 'error' && i.message.startsWith(`${id}: `))
      ?.message.slice(id.length + 2);
  const update = (id: string, patch: Partial<PairRecord>) => motionUi.updatePair(id, patch);
  const fmt = (v: number) => Number(v.toPrecision(4)).toString();

  function describe(r: PairRecord): string {
    if (r.type === 'cam') return `${r.cam} on ${bodyName(r.bodyA)} → ${bodyName(r.bodyB)}`;
    if (r.type === 'gear') return `${r.teethA}:${r.teethB}, ${bodyName(r.bodyA)} → ${bodyName(r.bodyB)}`;
    return `${r.teethA} teeth, ${bodyName(r.bodyA)} → ${bodyName(r.bodyB)}`;
  }
</script>

<section>
  <h3>Cams and gears <span class="count">{pairs.length}</span></h3>
  <div class="add" role="group" aria-label="Add a cam or gear joint">
    <button class="btn outline" onclick={() => motionUi.addPair('cam')}>+ Cam</button>
    <button class="btn outline" onclick={() => motionUi.addPair('gear')}>+ Gears</button>
    <button class="btn outline" onclick={() => motionUi.addPair('rack')}>+ Rack</button>
  </div>
  <ul class="pairs">
    {#each pairs as r (r.id)}
      {@const res = resolved(r.id)}
      {@const err = problem(r.id)}
      <li class:open={motionUi.selectedPair === r.id}>
        <button
          class="row"
          onclick={() => (motionUi.selectedPair = motionUi.selectedPair === r.id ? null : r.id)}
        >
          <strong>{r.id}</strong>
          <span class="type">{TYPE[r.type]}</span>
          <span class="muted desc">{describe(r)}</span>
          {#if err}<span class="bad" title={err}><Icon name="alert" size={14} /></span>{/if}
        </button>
        {#if motionUi.selectedPair === r.id}
          <div class="edit">
            {#if err}<p class="issue"><Icon name="alert" size={14} /><span>{err}</span></p>{/if}
            {#if r.type === 'cam'}
              <label class="field">
                <span>Cam</span>
                <select
                  class="select"
                  value={r.cam}
                  onchange={(e) => update(r.id, { cam: e.currentTarget.value })}
                >
                  {#each project.cams as c (c.id)}<option value={c.id}>{c.id} · {c.name}</option>{/each}
                </select>
              </label>
            {/if}
            <div class="grid2">
              <label class="field">
                <span
                  >{r.type === 'cam'
                    ? 'Cam on link'
                    : r.type === 'gear'
                      ? 'Gear A on link'
                      : 'Pinion on link'}</span
                >
                <select
                  class="select"
                  value={r.bodyA}
                  onchange={(e) =>
                    update(r.id, {
                      bodyA: e.currentTarget.value,
                      pointA: pointsOf(e.currentTarget.value)[0] ?? '',
                    })}
                >
                  {#if r.type === 'cam'}<option value={GROUND}>Ground (fixed cam)</option>{/if}
                  {#each bodies as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
                </select>
              </label>
              <label class="field">
                <span>Centre</span>
                <select
                  class="select"
                  value={r.pointA}
                  onchange={(e) => update(r.id, { pointA: e.currentTarget.value })}
                >
                  {#each pointsOf(r.bodyA) as p (p)}<option value={p}>{pointName(p)}</option>{/each}
                </select>
              </label>
              <label class="field">
                <span
                  >{r.type === 'cam'
                    ? 'Follower link'
                    : r.type === 'gear'
                      ? 'Gear B on link'
                      : 'Rack link'}</span
                >
                <select
                  class="select"
                  value={r.bodyB}
                  onchange={(e) =>
                    update(r.id, {
                      bodyB: e.currentTarget.value,
                      pointB: pointsOf(e.currentTarget.value)[0] ?? '',
                      line: linesOf(e.currentTarget.value)[0] ?? '',
                    })}
                >
                  {#each bodies as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
                </select>
              </label>
              {#if r.type === 'rack'}
                <label class="field">
                  <span>Pitch line</span>
                  <select
                    class="select"
                    value={r.line}
                    onchange={(e) => update(r.id, { line: e.currentTarget.value })}
                  >
                    {#each linesOf(r.bodyB) as l (l)}<option value={l}>{l}</option>{/each}
                  </select>
                </label>
              {:else}
                <label class="field">
                  <span>{r.type === 'cam' ? 'Roller centre' : 'Centre'}</span>
                  <select
                    class="select"
                    value={r.pointB}
                    onchange={(e) => update(r.id, { pointB: e.currentTarget.value })}
                  >
                    {#each pointsOf(r.bodyB) as p (p)}<option value={p}>{pointName(p)}</option>{/each}
                  </select>
                </label>
              {/if}
            </div>
            {#if r.type === 'cam'}
              <NumberField
                label="Mount angle (blank = fit the roller)"
                unit="°"
                value={r.angle ?? (res?.type === 'cam' ? (res.alpha * 180) / Math.PI : undefined)}
                oncommit={(v) => update(r.id, { angle: v })}
              />
              <button class="btn outline" onclick={() => update(r.id, { angle: undefined })}
                >Fit to the drawn roller</button
              >
              {#if res?.type === 'cam'}
                <p class="muted small">
                  Roller radius {fmt(res.curve.rollerRadius)}
                  {L}, from the cam's design.
                </p>
              {/if}
            {:else}
              <div class="grid2">
                <NumberField
                  label={r.type === 'gear' ? 'Teeth A' : 'Pinion teeth'}
                  value={r.teethA}
                  oncommit={(v) => update(r.id, { teethA: Math.max(3, Math.round(v)) })}
                />
                {#if r.type === 'gear'}
                  <NumberField
                    label="Teeth B"
                    value={r.teethB}
                    oncommit={(v) => update(r.id, { teethB: Math.max(3, Math.round(v)) })}
                  />
                {/if}
                <NumberField
                  label="Pressure angle"
                  unit="°"
                  value={r.pressure}
                  oncommit={(v) => update(r.id, { pressure: Math.min(45, Math.max(0, v)) })}
                />
              </div>
              {#if res?.type === 'gear'}
                <p class="muted small">
                  Pitch radii {fmt(res.ra)} and {fmt(res.rb)}
                  {L} (module {fmt((2 * res.ra) / res.za)}
                  {L}); B turns
                  {fmt(res.za / res.zb)}× as fast as A, the other way.
                </p>
              {:else if res?.type === 'rack'}
                <p class="muted small">
                  Pitch radius {fmt(res.r)}
                  {L} (module {fmt((2 * res.r) / res.za)}
                  {L}): the rack moves {fmt((res.r * Math.PI) / 180)}
                  {L} per degree of pinion turn.
                </p>
              {/if}
            {/if}
            <button class="btn outline danger" onclick={() => motionUi.removePair(r.id)}>Delete {r.id}</button
            >
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if !pairs.length}
    <p class="muted small">
      Mount a cam from the Cam workspace on a link, mesh two gears turning on pivots, or drive a rack with a
      pinion.
    </p>
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .count {
    color: var(--text-faint);
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

  .pairs {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pairs li {
    border-radius: var(--radius-md);
  }

  .pairs li.open {
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .row {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: var(--space-2);
    align-items: baseline;
    width: 100%;
    padding: 6px var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .type {
    color: var(--accent);
    font-weight: 600;
  }

  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bad {
    color: var(--danger);
  }

  .edit {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-3);
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-3);
  }

  .issue {
    display: flex;
    gap: 6px;
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .issue :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .small {
    margin: 0;
    font-size: var(--text-sm);
  }

  .danger {
    justify-self: start;
    color: var(--danger);
  }
</style>
