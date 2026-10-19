<script lang="ts">
  import type { MechanismModel } from '../../core/mechanism/model';
  import { jointNames } from '../../core/mechanism/names';
  import { GROUND } from '../../core/mechanism/types';

  /** A joint named by its point and the two links it connects, with their colours. */
  let { model, id }: { model: MechanismModel; id: string } = $props();

  const joint = $derived(model.joints.find((j) => j.id === id));
  const name = $derived(jointNames(model).get(id));
  const link = (b: string) =>
    b === GROUND
      ? { name: 'ground', color: '' }
      : (model.bodies.find((x) => x.id === b) ?? { name: b, color: '' });
</script>

{#if joint && name}
  {@const a = link(joint.a)}
  {@const b = link(joint.b)}
  <span class="joint" title={`Joint ${joint.id} at ${joint.point}`}>
    <strong>{name.short.replace(/ \(.*\)$/, '')}</strong>
    <span class="links">
      <span class="dot" class:ground={!a.color} style:background={a.color || null}></span>{a.name}
      {joint.type === 'revolute' ? '–' : 'slot,'}
      <span class="dot" class:ground={!b.color} style:background={b.color || null}></span>{b.name}
    </span>
  </span>
{:else}
  {id}
{/if}

<style>
  .joint {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
  }

  .links {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
  }

  .dot.ground {
    border: 1px solid var(--text-faint);
    background: repeating-linear-gradient(135deg, var(--text-faint) 0 1px, transparent 1px 3px);
  }
</style>
