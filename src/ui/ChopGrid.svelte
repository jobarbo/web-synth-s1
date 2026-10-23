<script lang="ts">
  import { CHOP_NONE, CHOP_STEPS } from '../dsp/draw'

  interface Props {
    /** Masques [carré, scie, sub, bruit] : bit n = pas n+1 joué (1) ou coupé (0). */
    masks: number[]
    onchange: (masks: number[]) => void
  }

  let { masks, onchange }: Props = $props()

  const ROWS = ['Carré', 'Scie', 'Sub', 'Bruit']
  const plays = (mask: number, step: number) => ((mask >> step) & 1) === 1

  function toggle(row: number, step: number) {
    const next = [...masks]
    next[row] = masks[row] ^ (1 << step)
    onchange(next)
  }
</script>

<div class="chop" role="group" aria-label="Motifs OSC CHOP">
  {#each ROWS as name, row (name)}
    <span class="name">{name}</span>
    <div class="cells">
      {#each Array.from({ length: CHOP_STEPS }, (_, i) => i) as step (step)}
        <button
          type="button"
          class:cut={!plays(masks[row], step)}
          onclick={() => toggle(row, step)}
          aria-pressed={!plays(masks[row], step)}
          aria-label="{name}, pas {step + 1} {plays(masks[row], step) ? 'joué' : 'coupé'}"
        ></button>
      {/each}
    </div>
  {/each}
  <span></span>
  <button type="button" class="reset" onclick={() => onchange([CHOP_NONE, CHOP_NONE, CHOP_NONE, CHOP_NONE])}>
    Tout rétablir
  </button>
</div>

<style>
  .chop {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px 10px;
  }
  .name {
    font: 0.68rem var(--mono);
    color: var(--panel-text-muted);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(16, 16px);
    gap: 3px;
  }
  .cells button {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--panel-border);
    /* Allumé = l'onde passe ; éteint = coupé (comme les pads de la machine) */
    background: color-mix(in srgb, var(--accent) 55%, var(--panel-track));
    cursor: pointer;
  }
  .cells button.cut {
    background: var(--panel-track);
  }
  .cells button:focus-visible,
  .reset:focus-visible {
    outline: 2px solid var(--focus);
  }
  .reset {
    justify-self: start;
    font: 0.72rem var(--sans);
    color: var(--panel-text);
    background: var(--panel-hover);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
</style>
