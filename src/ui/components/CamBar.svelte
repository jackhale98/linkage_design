<script lang="ts">
  import Icon from './Icon.svelte';
  import { isOscillating } from '../../core/cam/types';
  import { store } from '../state/project.svelte';
  import { CAM_AUTO_REV_S, camUi } from '../state/cam.svelte';

  const a = $derived(camUi.analysis);
  const x = $derived(a.samples[camUi.sampleIndex]);
  const unit = $derived(
    isOscillating(camUi.cam?.follower ?? 'translating_roller') ? '°' : ` ${store.project.meta.length_unit}`,
  );
  const SPEEDS = [0.1, 0.25, 0.5, 1];
</script>

{#if a.ok && x}
  <div class="bar" role="group" aria-label="Cam playback">
    <button
      class="btn icon play"
      aria-label={camUi.playing ? 'Pause' : 'Play'}
      title={`${camUi.playing ? 'Pause' : 'Play'} (Space)`}
      onclick={() => camUi.toggle()}
    >
      <Icon name={camUi.playing ? 'pause' : 'play'} size={18} />
    </button>
    <input
      type="range"
      class="scrub"
      min="0"
      max="360"
      step={camUi.cam?.step ?? 1}
      value={x.angle}
      aria-label="Cam angle"
      oninput={(e) => {
        camUi.pause();
        camUi.angle = Number(e.currentTarget.value);
      }}
    />
    <span class="readout num">
      θ = {x.angle.toFixed(1)}° · s = {x.s.toFixed(2)}{unit}
      <span class="muted">· t = {x.time.toFixed(3)} s</span>
    </span>
    <select
      class="speed"
      aria-label="Playback speed"
      title={`Playback speed. Auto: one revolution every ${CAM_AUTO_REV_S} s. 1× = real time at the cam speed.`}
      value={camUi.playbackSpeed}
      onchange={(e) => (camUi.playbackSpeed = Number(e.currentTarget.value))}
    >
      <option value={0}>Auto</option>
      {#each SPEEDS as s (s)}<option value={s}>{s}× real time</option>{/each}
    </select>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: min(560px, 100%);
    padding: 6px var(--space-3) 6px 6px;
    border: 1px solid var(--border);
    border-radius: 24px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-md);
  }

  .play {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }

  .play:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .scrub {
    flex: 1;
    min-width: 80px;
    accent-color: var(--accent);
  }

  .readout {
    min-width: 24ch;
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .readout .muted {
    font-weight: 400;
  }

  .speed {
    height: 28px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-sm);
  }

  @media (max-width: 720px) {
    .readout .muted {
      display: none;
    }
  }
</style>
