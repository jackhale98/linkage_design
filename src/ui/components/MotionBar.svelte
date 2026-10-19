<script lang="ts">
  import Icon from './Icon.svelte';
  import { inputValue, timeOf } from '../../core/mechanism/analysis';
  import { store } from '../state/project.svelte';
  import { AUTO_PASS_S, motionUi } from '../state/motion.svelte';

  const frames = $derived(motionUi.frames);
  const data = $derived(motionUi.result.data);
  const frame = $derived(motionUi.frame);
  const rotary = $derived(motionUi.result.model.driver?.type === 'rotary');
  const unit = $derived(
    rotary ? (store.project.meta.angle_unit === 'deg' ? '°' : ' rad') : ` ${store.project.meta.length_unit}`,
  );
  const symbol = $derived(rotary ? 'θ' : 'L');
  const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
</script>

{#if frames.length > 1 && data}
  <div class="bar" role="group" aria-label="Playback">
    <button
      class="btn icon play"
      aria-label={motionUi.playing ? 'Pause' : 'Play'}
      title={`${motionUi.playing ? 'Pause' : 'Play'} (Space)`}
      onclick={() => motionUi.toggle()}
    >
      <Icon name={motionUi.playing ? 'pause' : 'play'} size={18} />
    </button>
    <input
      type="range"
      class="scrub"
      min="0"
      max={frames.length - 1}
      step="1"
      value={motionUi.frameIndex}
      aria-label="Driver position"
      oninput={(e) => {
        motionUi.pause();
        motionUi.seek(Number(e.currentTarget.value));
      }}
    />
    {#if frame}
      <span class="readout num">
        {symbol} = {inputValue(data, frame).toFixed(rotary ? 1 : 2)}{unit}
        <span class="muted">· t = {timeOf(data, frame).toFixed(3)} s</span>
      </span>
    {/if}
    <select
      class="speed"
      aria-label="Playback speed"
      title={`Playback speed. Auto: one ${motionUi.result.res?.fullRotation ? 'revolution' : 'stroke'} every ${AUTO_PASS_S} s. 1× = real time at the driver speed.`}
      value={motionUi.playbackSpeed}
      onchange={(e) => (motionUi.playbackSpeed = Number(e.currentTarget.value))}
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
    min-width: 17ch;
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
