<script lang="ts">
  import { clamp } from '../dsp/math'

  interface Props {
    label: string
    /** -1..1 si bipolaire (pitch bend), sinon 0..1 (modulation). */
    value: number
    bipolar?: boolean
    /** Revient au centre au relâchement, comme une molette de pitch bend à ressort. */
    springBack?: boolean
    onchange: (v: number) => void
  }

  let { label, value, bipolar = false, springBack = false, onchange }: Props = $props()

  let strip: HTMLDivElement
  let dragging = false

  const rest = $derived(bipolar ? 0 : value)
  // Position 0..1 de haut en bas pour l'affichage
  const position = $derived(bipolar ? (1 - value) / 2 : 1 - value)

  // Position absolue : la molette suit le doigt, comme une vraie molette
  function valueAt(clientY: number) {
    const r = strip.getBoundingClientRect()
    const u = clamp(1 - (clientY - r.top) / r.height, 0, 1)
    return bipolar ? u * 2 - 1 : u
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      strip.setPointerCapture(e.pointerId)
    } catch {}
    dragging = true
    onchange(valueAt(e.clientY))
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) onchange(valueAt(e.clientY))
  }

  function release() {
    if (!dragging) return
    dragging = false
    if (springBack) onchange(rest)
  }

  function onkeydown(e: KeyboardEvent) {
    const step = e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowDown' ? -0.1 : 0
    if (!step) return
    e.preventDefault()
    onchange(clamp(value + step, bipolar ? -1 : 0, 1))
  }
</script>

<div class="wheel">
  <div
    class="strip"
    class:bipolar
    bind:this={strip}
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={bipolar ? -1 : 0}
    aria-valuemax={1}
    aria-valuenow={value}
    {onpointerdown}
    {onpointermove}
    onpointerup={release}
    onpointercancel={release}
    onkeyup={() => springBack && onchange(rest)}
    {onkeydown}
  >
    <div class="thumb" style:top="calc(6px + {position} * (100% - 12px))"></div>
  </div>
  <span>{label}</span>
</div>

<style>
  .wheel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .strip {
    position: relative;
    width: 22px;
    flex: 1;
    min-height: 90px;
    border-radius: 6px;
    background: var(--panel-track);
    border: 1px solid var(--panel-border);
    touch-action: none;
    cursor: ns-resize;
    outline: none;
  }
  .strip:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  .strip.bipolar::after {
    content: '';
    position: absolute;
    left: 3px;
    right: 3px;
    top: 50%;
    border-top: 1px dashed var(--panel-text-muted);
    opacity: 0.5;
  }
  .thumb {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 12px;
    margin-top: -6px;
    border-radius: 3px;
    background: var(--panel-cap);
    box-shadow: inset 0 -2px 0 var(--accent);
    pointer-events: none;
  }
  span {
    font: 0.62rem var(--mono);
    color: var(--panel-text-muted);
  }
</style>
