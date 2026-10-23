<script lang="ts">
  import { dragValue, keyStep } from './dragValue'

  interface Props {
    value: number
    defaultValue: number
    label: string
    display: string
    onchange: (v: number) => void
    /** Grisé et sans réaction quand le réglage n'a pas d'effet. Reste en place pour ne pas décaler l'UI. */
    disabled?: boolean
    /** Slider à crans : les flèches avancent d'un cran. */
    steps?: number
  }

  let { value, defaultValue, label, display, onchange, disabled = false, steps }: Props = $props()

  const W = 36
  const H = 132
  const PAD = 10
  const THUMB_H = 18
  const TRAVEL = H - 2 * PAD - THUMB_H
  const TICKS = Array.from({ length: 11 }, (_, i) => PAD + THUMB_H / 2 + (i / 10) * TRAVEL)

  const thumbY = $derived(PAD + (1 - value) * TRAVEL)

  function onkeydown(e: KeyboardEvent) {
    if (disabled) return
    let next = keyStep(value, e.key, e.shiftKey)
    if (next === null) return
    e.preventDefault()
    if (steps && e.key.startsWith('Arrow')) next = Math.min(1, Math.max(0, value + Math.sign(next - value) / (steps - 1)))
    onchange(next)
  }
</script>

<div class="slider" class:disabled>
  <output>{display}</output>
  <svg
    width={W}
    height={H}
    viewBox="0 0 {W} {H}"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-disabled={disabled}
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={1}
    aria-valuenow={value}
    aria-valuetext={display}
    use:dragValue={{ value, travelPx: TRAVEL, onchange, disabled }}
    ondblclick={() => !disabled && onchange(defaultValue)}
    {onkeydown}
  >
    {#each TICKS as y, i (i)}
      <line class="tick" class:major={i % 5 === 0} x1={i % 5 === 0 ? 2 : 5} x2="9" y1={y} y2={y} />
    {/each}
    <rect class="track" x={W / 2 - 2} y={PAD} width="4" height={H - 2 * PAD} rx="2" />
    <rect class="fill" x={W / 2 - 2} y={thumbY + THUMB_H / 2} width="4" height={H - PAD - thumbY - THUMB_H / 2} rx="2" />
    <g class="thumb" transform="translate(0 {thumbY})">
      <rect x={W / 2 - 9} width="18" height={THUMB_H} rx="3" />
      <line x1={W / 2 - 6} x2={W / 2 + 6} y1={THUMB_H / 2} y2={THUMB_H / 2} />
    </g>
  </svg>
  <span class="label">{label}</span>
</div>

<style>
  .slider.disabled {
    opacity: 0.35;
  }
  .slider.disabled svg {
    cursor: default;
  }
  .slider {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 52px;
  }
  svg {
    cursor: ns-resize;
    touch-action: none;
    outline: none;
    border-radius: 6px;
  }
  svg:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  .tick {
    stroke: var(--panel-tick);
    stroke-width: 1;
  }
  .tick.major {
    stroke: var(--panel-text-muted);
  }
  .track {
    fill: var(--panel-track);
  }
  .fill {
    fill: var(--accent);
    opacity: 0.55;
  }
  .thumb rect {
    fill: var(--panel-cap);
    stroke: var(--panel-cap-edge);
  }
  .thumb line {
    stroke: var(--accent);
    stroke-width: 2;
  }
  svg:hover .thumb rect {
    fill: var(--panel-cap-hover);
  }
  output {
    font: 0.68rem var(--mono);
    color: var(--panel-text-muted);
    white-space: nowrap;
    min-height: 1em;
  }
  .label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--panel-text);
  }
</style>
