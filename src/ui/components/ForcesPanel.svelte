<script lang="ts">
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import { massUnit, LOAD_TYPES, type Load, type LoadType } from '../../core/forces/types';
  import { GROUND } from '../../core/mechanism/types';
  import { jointNames } from '../../core/mechanism/names';
  import { store } from '../state/project.svelte';
  import { motionUi } from '../state/motion.svelte';

  const project = $derived(store.project);
  const forces = $derived(project.forces);
  const r = $derived(motionUi.result);
  const model = $derived(r.model);
  const fr = $derived(motionUi.forces);
  const L = $derived(project.meta.length_unit);
  const F = $derived(project.meta.force_unit);
  const M = $derived(massUnit({ length: L, force: F }));
  const A = $derived(project.meta.angle_unit === 'deg' ? '°' : 'rad');
  const ready = $derived(!!r.data && fr.frames.length > 0);
  const maxBalance = $derived(fr.frames.length ? Math.max(...fr.frames.map((f) => f.balance)) : 0);

  const movingBodies = $derived(
    project.mechanism.bodies.filter((b) => model.bodies.some((m) => m.id === b.id)),
  );
  const bodyName = (id: string) =>
    id === GROUND ? 'ground' : (project.mechanism.bodies.find((b) => b.id === id)?.name ?? id);
  const pointLabel = (p: string) => model.pointNames.get(p) ?? p;
  const names = $derived(jointNames(model));
  const jointLabel = (id: string) => names.get(id)?.long ?? id;

  // Solving for the output: candidate output joints (a pivot to ground, or a pin or block in a ground slot).
  const outputs = $derived(
    model.joints.filter(
      (j) => (j.a === GROUND) !== (j.b === GROUND) && (j.type === 'revolute' || j.a === GROUND),
    ),
  );
  const driver = $derived(model.driver);
  const rotaryIn = $derived(driver?.type === 'rotary');
  const inputPivot = $derived(
    driver?.type === 'rotary'
      ? model.joints.find(
          (j) =>
            j.type === 'revolute' &&
            (j.a === driver.body || j.b === driver.body) &&
            (j.a === driver.refBody || j.b === driver.refBody),
        )
      : undefined,
  );
  const outJoint = $derived(model.joints.find((j) => j.id === forces.outputJoint));
  const pointsOf = (body: string | undefined, except?: string) =>
    (model.bodies.find((b) => b.id === body)?.points ?? []).filter((p) => p !== except);

  function solveForOutput() {
    // Default output: a simple link (fewest joints, like a crank or rocker) far from the input pivot.
    const joints = (body: string) => model.joints.filter((j) => j.a === body || j.b === body).length;
    const pos = (p?: string) => (p ? model.positions.get(p) : undefined);
    const from = pos(inputPivot?.point) ?? [0, 0];
    const dist = (p: string) => Math.hypot(pos(p)![0] - from[0], pos(p)![1] - from[1]);
    const ranked = outputs
      .filter((j) => j.id !== inputPivot?.id)
      .map((j) => ({ j, n: joints(j.a === GROUND ? j.b : j.a), d: dist(j.point) }))
      .sort((x, y) => x.n - y.n || y.d - x.d);
    const pick = forces.outputJoint || ranked[0]?.j.id || outputs[0]?.id || '';
    motionUi.setAnalysis({ solveFor: 'output', outputJoint: pick, input: forces.input || 100 });
  }
  const allPoints = $derived(
    [...new Set([...model.bodies.flatMap((b) => b.points), ...model.groundPoints])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
  );
  const revolutes = $derived(model.joints.filter((j) => j.type === 'revolute'));

  const LABEL: Record<LoadType, string> = {
    force: 'Force',
    torque: 'Torque',
    spring: 'Spring',
    torsion: 'Torsion spring',
  };

  function describe(l: Load): string {
    switch (l.type) {
      case 'force':
        return `(${l.fx}, ${l.fy}) ${F} at ${pointLabel(l.point)} on ${bodyName(l.body)}${l.frame === 'body' ? ', turns with it' : ''}${l.oppose ? ', resists motion' : ''}`;
      case 'torque':
        return `${l.oppose ? '±' : ''}${l.torque} ${F}·${L} on ${bodyName(l.body)}${l.oppose ? ', resists motion' : ''}`;
      case 'spring':
        return `${l.point}–${l.pointB}, k = ${l.k} ${F}/${L}`;
      case 'torsion':
        return `at ${jointLabel(l.joint)}, k = ${l.k} ${F}·${L}/${A}`;
    }
  }

  let density = $state(0.002);
  const update = (id: string, patch: Partial<Load>) => motionUi.updateLoad(id, patch);
</script>

<header>
  <h2>Forces</h2>
  {#if ready}
    <p class="status ok">
      <Icon name="check" size={16} />
      {forces.mode === 'static' ? 'Static' : 'Kinetostatic'} analysis over {fr.frames.length} positions
    </p>
    <p
      class="muted small"
      title="Input power equals the power of all loads and inertia, as it must (virtual work)."
    >
      Power balance check: {maxBalance < 1e-6 ? 'passed' : 'FAILED'} (max error {maxBalance.toExponential(1)})
    </p>
  {:else}
    <p class="status"><Icon name="info" size={16} /> The mechanism must move before forces can be found.</p>
  {/if}
  {#each [...fr.issues, ...r.issues.map((i) => i.message)] as msg, i (i)}
    <p class="issue"><Icon name="alert" size={15} /><span>{msg}</span></p>
  {/each}
</header>

<section>
  <h3>Analysis</h3>
  <div class="seg" role="radiogroup" aria-label="Analysis mode">
    <button
      role="radio"
      aria-checked={forces.mode === 'static'}
      class:on={forces.mode === 'static'}
      onclick={() => motionUi.setAnalysis({ mode: 'static' })}
    >
      Static
    </button>
    <button
      role="radio"
      aria-checked={forces.mode === 'kinetostatic'}
      class:on={forces.mode === 'kinetostatic'}
      onclick={() => motionUi.setAnalysis({ mode: 'kinetostatic' })}
    >
      With inertia
    </button>
  </div>
  <p class="muted small">
    {forces.mode === 'static'
      ? 'Applied loads only (slow motion).'
      : `Adds each link's inertia at the driver speed (${project.mechanism.driver.speed} ${project.mechanism.driver.type === 'linear' ? `${L}/s` : 'rpm'}).`}
  </p>
  <label class="check">
    <input
      type="checkbox"
      checked={forces.gravity}
      onchange={(e) => motionUi.setAnalysis({ gravity: e.currentTarget.checked })}
    />
    Gravity (downward, −y)
  </label>
</section>

<section>
  <h3>Solve for</h3>
  <div class="seg" role="radiogroup" aria-label="Solve for">
    <button
      role="radio"
      aria-checked={forces.solveFor === 'input'}
      class:on={forces.solveFor === 'input'}
      onclick={() => motionUi.setAnalysis({ solveFor: 'input' })}
    >
      Input needed
    </button>
    <button
      role="radio"
      aria-checked={forces.solveFor === 'output'}
      class:on={forces.solveFor === 'output'}
      onclick={solveForOutput}
    >
      Output from input
    </button>
  </div>
  <p class="muted small">
    {forces.solveFor === 'input'
      ? `The loads are known: finds the ${rotaryIn ? 'torque' : 'force'} the input needs at each position to drive them.`
      : `The input ${rotaryIn ? 'torque' : 'force'} is known: finds what the output delivers, and the force at every joint.`}
  </p>
  {#if forces.solveFor === 'output'}
    <NumberField
      label={rotaryIn ? 'Input torque (counterclockwise +)' : 'Actuator force (+ pushes apart)'}
      unit={rotaryIn ? `${F}·${L}` : F}
      value={forces.input}
      oncommit={(v) => motionUi.setAnalysis({ input: v })}
    />
    <label class="field">
      <span>Output at</span>
      <select
        class="select"
        value={forces.outputJoint}
        onchange={(e) => motionUi.setAnalysis({ outputJoint: e.currentTarget.value, outputPoint: '' })}
      >
        <option value="" disabled>Choose a pivot or slot on ground</option>
        {#each outputs as j (j.id)}<option value={j.id}>{jointLabel(j.id)}</option>{/each}
      </select>
    </label>
    {#if outJoint?.type === 'revolute'}
      {@const pts = pointsOf(outJoint.a === GROUND ? outJoint.b : outJoint.a, outJoint.point)}
      <label class="field">
        <span>Show the output as a force at</span>
        <select
          class="select"
          value={forces.outputPoint}
          onchange={(e) => motionUi.setAnalysis({ outputPoint: e.currentTarget.value })}
        >
          <option value="">(torque only)</option>
          {#each pts as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
        </select>
      </label>
    {/if}
  {/if}
  {#if rotaryIn && driver?.type === 'rotary'}
    <label class="field">
      <span>Show the input as a force at</span>
      <select
        class="select"
        value={forces.inputPoint}
        onchange={(e) => motionUi.setAnalysis({ inputPoint: e.currentTarget.value })}
      >
        <option value="">(torque only)</option>
        {#each pointsOf(driver.body, inputPivot?.point) as p (p)}<option value={p}>{pointLabel(p)}</option
          >{/each}
      </select>
    </label>
    <p class="muted small">A force at a point means the push at right angles to the line from the pivot.</p>
  {/if}
</section>

<section>
  <h3>Loads <span class="count">{forces.loads.length}</span></h3>
  <div class="add" role="group" aria-label="Add a load">
    {#each LOAD_TYPES as t (t)}
      <button class="btn outline" onclick={() => motionUi.addLoad(t)}>+ {LABEL[t]}</button>
    {/each}
  </div>
  <ul class="loads">
    {#each forces.loads as l (l.id)}
      <li class:open={motionUi.selectedLoad === l.id}>
        <button
          class="row"
          onclick={() => (motionUi.selectedLoad = motionUi.selectedLoad === l.id ? null : l.id)}
        >
          <strong>{l.id}</strong>
          <span class="type">{LABEL[l.type]}</span>
          <span class="muted desc">{describe(l)}</span>
        </button>
        {#if motionUi.selectedLoad === l.id}
          <div class="edit">
            {#if l.type === 'force' || l.type === 'torque'}
              <label class="field">
                <span>On link</span>
                <select
                  class="select"
                  value={l.body}
                  onchange={(e) => update(l.id, { body: e.currentTarget.value })}
                >
                  {#each movingBodies as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
                </select>
              </label>
            {/if}
            {#if l.type === 'force'}
              {@const pts = model.bodies.find((b) => b.id === l.body)?.points ?? []}
              <label class="field">
                <span>At point</span>
                <select
                  class="select"
                  value={l.point}
                  onchange={(e) => update(l.id, { point: e.currentTarget.value })}
                >
                  {#each pts as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
                </select>
              </label>
              <div class="grid2">
                <NumberField label="Fx" unit={F} value={l.fx} oncommit={(v) => update(l.id, { fx: v })} />
                <NumberField label="Fy" unit={F} value={l.fy} oncommit={(v) => update(l.id, { fy: v })} />
              </div>
              <label class="check">
                <input
                  type="checkbox"
                  checked={l.frame === 'body'}
                  onchange={(e) => update(l.id, { frame: e.currentTarget.checked ? 'body' : 'global' })}
                />
                Direction turns with the link
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={l.oppose}
                  onchange={(e) => update(l.id, { oppose: e.currentTarget.checked })}
                />
                Resists the motion (flips with the direction of travel)
              </label>
              {#if l.oppose && !r.data?.cycle && !r.res?.fullRotation}
                <p class="note small">
                  <Icon name="info" size={13} />
                  <span
                    >To see the way back too, turn on <em>There and back</em> in the Mechanism driver settings.</span
                  >
                </p>
              {/if}
            {:else if l.type === 'torque'}
              <NumberField
                label="Torque (counterclockwise +)"
                unit={`${F}·${L}`}
                value={l.torque}
                oncommit={(v) => update(l.id, { torque: v })}
              />
              <label class="check">
                <input
                  type="checkbox"
                  checked={l.oppose}
                  onchange={(e) => update(l.id, { oppose: e.currentTarget.checked })}
                />
                Resists the motion (flips with the direction of travel)
              </label>
              {#if l.oppose && !r.data?.cycle && !r.res?.fullRotation}
                <p class="note small">
                  <Icon name="info" size={13} />
                  <span
                    >To see the way back too, turn on <em>There and back</em> in the Mechanism driver settings.</span
                  >
                </p>
              {/if}
              {#if driver?.type === 'rotary' && l.body === driver.body && forces.solveFor === 'input'}
                <p class="note small">
                  <Icon name="info" size={13} />
                  <span>
                    This torque is on the driven link, so the driver simply cancels it and no joint carries a
                    load. To see what an input torque produces at another joint, set Solve for to
                    <em>Output from input</em>.
                  </span>
                </p>
              {/if}
            {:else if l.type === 'spring'}
              <div class="grid2">
                <label class="field">
                  <span>From</span>
                  <select
                    class="select"
                    value={l.point}
                    onchange={(e) => update(l.id, { point: e.currentTarget.value })}
                  >
                    {#each allPoints as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
                  </select>
                </label>
                <label class="field">
                  <span>To</span>
                  <select
                    class="select"
                    value={l.pointB}
                    onchange={(e) => update(l.id, { pointB: e.currentTarget.value })}
                  >
                    {#each allPoints as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
                  </select>
                </label>
                <NumberField
                  label="Stiffness k"
                  unit={`${F}/${L}`}
                  value={l.k}
                  oncommit={(v) => update(l.id, { k: Math.max(0, v) })}
                />
                <NumberField
                  label="Preload (tension)"
                  unit={F}
                  value={l.preload}
                  oncommit={(v) => update(l.id, { preload: v })}
                />
              </div>
              <NumberField
                label="Free length (blank = as drawn)"
                unit={L}
                value={l.free}
                oncommit={(v) => update(l.id, { free: v > 0 ? v : undefined })}
              />
            {:else}
              <label class="field">
                <span>At joint</span>
                <select
                  class="select"
                  value={l.joint}
                  onchange={(e) => update(l.id, { joint: e.currentTarget.value })}
                >
                  {#each revolutes as j (j.id)}<option value={j.id}
                      >{j.id} · {bodyName(j.a)} – {bodyName(j.b)}</option
                    >{/each}
                </select>
              </label>
              <div class="grid2">
                <NumberField
                  label="Stiffness k"
                  unit={`${F}·${L}/${A}`}
                  value={l.k}
                  oncommit={(v) => update(l.id, { k: Math.max(0, v) })}
                />
                <NumberField
                  label="Preload"
                  unit={`${F}·${L}`}
                  value={l.preload}
                  oncommit={(v) => update(l.id, { preload: v })}
                />
              </div>
            {/if}
            <button class="btn outline danger" onclick={() => motionUi.deleteLoad(l.id)}>Delete load</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if !forces.loads.length}
    <p class="muted small">
      Add forces, torques or springs. Select a point or link on the canvas first to place the load there.
    </p>
  {/if}
</section>

<section>
  <h3>Mass properties</h3>
  <table class="mass">
    <thead><tr><th>Link</th><th>Mass ({M})</th><th>Inertia ({M}·{L}²)</th></tr></thead>
    <tbody>
      {#each movingBodies as b (b.id)}
        <tr>
          <td class="name" title={b.name}><span class="dot" style:background={b.color}></span>{b.name}</td>
          <td>
            <input
              class="cell num"
              aria-label={`${b.name} mass`}
              value={b.mass ?? ''}
              placeholder="0"
              onchange={(e) => {
                const v = Number(e.currentTarget.value.replace(',', '.'));
                motionUi.setMass(b.id, { mass: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
            />
          </td>
          <td>
            <input
              class="cell num"
              aria-label={`${b.name} inertia`}
              value={b.inertia ?? ''}
              placeholder="0"
              onchange={(e) => {
                const v = Number(e.currentTarget.value.replace(',', '.'));
                motionUi.setMass(b.id, { inertia: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
            />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="muted small">
    Each link's centre of mass is taken from the project file if set there, otherwise the middle of its lines.
    Leave mass blank for massless links.
  </p>
  <div class="estimate">
    <NumberField
      label="Bar mass per length"
      unit={`${M}/${L}`}
      value={density}
      oncommit={(v) => (density = Math.max(0, v))}
    />
    <button
      class="btn outline"
      onclick={() => motionUi.estimateMasses(density)}
      title="Treat every link as uniform slender bars"
    >
      Estimate all
    </button>
  </div>
</section>

<section>
  <h3>Display</h3>
  <label class="check"
    ><input type="checkbox" bind:checked={motionUi.showLoads} /> Applied loads and gravity</label
  >
  <label class="check"
    ><input type="checkbox" bind:checked={motionUi.showReactions} /> Joint reaction forces</label
  >
</section>

<style>
  header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .status.ok {
    color: var(--success);
  }

  .small {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
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

  section {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .note {
    display: flex;
    gap: 6px;
    margin: 0;
    color: var(--text-muted);
  }

  .note :global(svg) {
    flex: none;
    margin-top: 2px;
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

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .check input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }

  .add {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }

  .add .btn {
    height: 30px;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .loads {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .loads li {
    border-radius: var(--radius-md);
  }

  .loads li.open {
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .row {
    display: grid;
    grid-template-columns: auto auto 1fr;
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
    color: var(--load-applied);
    font-weight: 600;
  }

  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .danger {
    justify-self: start;
    color: var(--danger);
  }

  .mass {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .mass th {
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
  }

  .mass td,
  .mass th {
    padding: 2px 4px;
    border-bottom: 1px solid var(--border);
  }

  .mass td.name {
    max-width: 7.5em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 3px;
  }

  .cell {
    width: 100%;
    height: 26px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
  }

  .cell:hover {
    border-color: var(--border);
  }

  .cell:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
  }

  .estimate {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
    align-items: end;
  }
</style>
