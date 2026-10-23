<script lang="ts">
  import { clamp } from '../dsp/math'

  interface Props {
    /** x : gauche-droite (roll), y : avant-arrière (pitch), -1..1 ; (0, 0) au relâchement. */
    onmove: (x: number, y: number) => void
  }

  let { onmove }: Props = $props()

  let pad: HTMLDivElement
  let x = $state(0)
  let y = $state(0)
  let active = $state(false)

  function set(nx: number, ny: number) {
    x = clamp(nx, -1, 1)
    y = clamp(ny, -1, 1)
    onmove(x, y)
  }

  // Comme le bouton D-MOTION : effet tant qu'on appuie, retour au son d'origine au relâchement
  function release() {
    active = false
    set(0, 0)
  }

  function fromPointer(e: PointerEvent) {
    const r = pad.getBoundingClientRect()
    set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2)
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      pad.setPointerCapture(e.pointerId)
    } catch {}
    active = true
    fromPointer(e)
  }

  // Inclinaison réelle de l'appareil (option) : roll = gamma, pitch = beta relatif à la position de départ
  const tiltSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
  let tiltEnabled = $state(false)
  let tilting = $state(false)
  let tiltError = $state('')
  let baseBeta: number | null = null
  const TILT_RANGE = 45

  async function enableTilt() {
    tiltError = ''
    // iOS demande une autorisation explicite, à l'intérieur d'un geste utilisateur
    const ctor = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
    try {
      if (ctor.requestPermission && (await ctor.requestPermission()) !== 'granted') {
        tiltError = 'Autorisation refusée'
        return
      }
      tiltEnabled = true
    } catch (e) {
      tiltError = e instanceof Error ? e.message : String(e)
    }
  }

  $effect(() => {
    if (!tiltEnabled) return
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (!tilting || e.gamma === null || e.beta === null) return
      baseBeta ??= e.beta
      set(e.gamma / TILT_RANGE, -(e.beta - baseBeta) / TILT_RANGE)
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => window.removeEventListener('deviceorientation', onOrientation)
  })

  function tiltDown(e: PointerEvent) {
    e.preventDefault()
    baseBeta = null
    tilting = true
    active = true
  }

  function tiltUp() {
    tilting = false
    release()
  }
</script>

<div class="motion">
  <div
    class="pad"
    class:active
    bind:this={pad}
    {onpointerdown}
    onpointermove={(e) => active && !tilting && fromPointer(e)}
    onpointerup={release}
    onpointercancel={release}
    role="application"
    aria-label="Pad D-MOTION : glisser pour modifier le son, relâcher pour revenir"
  >
    <span class="cross" aria-hidden="true"></span>
    <span class="dot" style:left="{(x + 1) * 50}%" style:top="{(1 - y) * 50}%" aria-hidden="true"></span>
    <span class="axis-label x">X</span>
    <span class="axis-label y">Y</span>
  </div>

  {#if tiltSupported}
    {#if !tiltEnabled}
      <button type="button" onclick={enableTilt}>Activer l'inclinaison</button>
    {:else}
      <button
        type="button"
        class="hold"
        class:on={tilting}
        onpointerdown={tiltDown}
        onpointerup={tiltUp}
        onpointercancel={tiltUp}
        onpointerleave={() => tilting && tiltUp()}
      >
        Maintenir et incliner
      </button>
    {/if}
    {#if tiltError}<span class="error">{tiltError}</span>{/if}
  {/if}
</div>

<style>
  .motion {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .pad {
    position: relative;
    width: 160px;
    height: 160px;
    border-radius: 10px;
    background: var(--panel-track);
    border: 1px solid var(--panel-border);
    touch-action: none;
    cursor: grab;
  }
  .pad.active {
    cursor: grabbing;
    border-color: var(--accent);
  }
  .cross::before,
  .cross::after {
    content: '';
    position: absolute;
    background: var(--panel-tick);
  }
  .cross::before {
    left: 50%;
    top: 8px;
    bottom: 8px;
    width: 1px;
  }
  .cross::after {
    top: 50%;
    left: 8px;
    right: 8px;
    height: 1px;
  }
  .dot {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    border-radius: 50%;
    background: var(--panel-cap);
    box-shadow: 0 0 0 2px var(--accent);
    pointer-events: none;
  }
  .axis-label {
    position: absolute;
    font: 0.6rem var(--mono);
    color: var(--panel-text-muted);
  }
  .axis-label.x {
    right: 6px;
    top: calc(50% + 4px);
  }
  .axis-label.y {
    left: calc(50% + 4px);
    top: 4px;
  }
  button {
    font: 0.72rem var(--sans);
    color: var(--panel-text);
    background: var(--panel-hover);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
    touch-action: none;
  }
  button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  button:focus-visible {
    outline: 2px solid var(--focus);
  }
  .error {
    font-size: 0.7rem;
    color: var(--danger);
  }
</style>
