<script lang="ts">
  import { DRAW_STEPS, INIT_DRAW_FORM } from '../dsp/draw'

  interface Props {
    /** 16 valeurs -100..100 */
    form: number[]
    /** Pente entre les pas (mode Slope) : aperçu en ligne brisée. */
    slope: boolean
    onchange: (form: number[]) => void
  }

  let { form, slope, onchange }: Props = $props()

  const W = 320
  const H = 140
  const STEP_W = W / DRAW_STEPS
  const y = (v: number) => H / 2 - (v / 100) * (H / 2 - 4)

  let svg: SVGSVGElement
  let drawing = false
  /** Dernier point peint : un geste rapide qui saute des pas est complété par interpolation. */
  let last: { i: number; v: number } | null = null

  const quantize = (v: number) => Math.max(-100, Math.min(100, Math.round(v / 5) * 5))

  // Dessin à main levée : chaque pas survolé prend la hauteur du pointeur
  function paint(e: PointerEvent) {
    const r = svg.getBoundingClientRect()
    const i = Math.max(0, Math.min(DRAW_STEPS - 1, Math.floor(((e.clientX - r.left) / r.width) * DRAW_STEPS)))
    const v = quantize((1 - ((e.clientY - r.top) / r.height) * 2) * 104)
    const next = [...form]
    if (last && last.i !== i) {
      const dir = i > last.i ? 1 : -1
      for (let k = last.i + dir; k !== i; k += dir) next[k] = quantize(last.v + ((v - last.v) * (k - last.i)) / (i - last.i))
    }
    next[i] = v
    last = { i, v }
    if (next.some((x, k) => x !== form[k])) onchange(next)
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    // La capture peut échouer (pointeur déjà relâché) : le dessin doit continuer quand même
    try {
      svg.setPointerCapture(e.pointerId)
    } catch {}
    drawing = true
    last = null
    paint(e)
  }

  const PRESETS: { label: string; form: () => number[] }[] = [
    { label: 'Triangle', form: () => [...INIT_DRAW_FORM] },
    { label: 'Scie', form: () => Array.from({ length: DRAW_STEPS }, (_, i) => Math.round(100 - (200 * i) / (DRAW_STEPS - 1))) },
    { label: 'Sinus', form: () => Array.from({ length: DRAW_STEPS }, (_, i) => Math.round(Math.sin((2 * Math.PI * i) / DRAW_STEPS) * 100)) },
    { label: 'Carré', form: () => Array.from({ length: DRAW_STEPS }, (_, i) => (i < DRAW_STEPS / 2 ? 100 : -100)) },
    { label: 'Zéro', form: () => Array.from({ length: DRAW_STEPS }, () => 0) },
  ]

  const outline = $derived(
    slope
      ? [...form, form[0]].map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * STEP_W} ${y(v)}`).join(' ')
      : form.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * STEP_W} ${y(v)} H ${(i + 1) * STEP_W}`).join(' '),
  )

  function onkeydown(e: KeyboardEvent, i: number) {
    const delta = e.key === 'ArrowUp' ? 5 : e.key === 'ArrowDown' ? -5 : 0
    if (!delta) return
    e.preventDefault()
    const next = [...form]
    next[i] = Math.max(-100, Math.min(100, next[i] + delta))
    onchange(next)
  }
</script>

<div class="draw">
  <svg
    bind:this={svg}
    viewBox="0 0 {W} {H}"
    width={W}
    height={H}
    {onpointerdown}
    onpointermove={(e) => drawing && paint(e)}
    onpointerup={() => (drawing = false)}
    onpointercancel={() => (drawing = false)}
    role="group"
    aria-label="Forme OSC DRAW : 16 pas de -100 à 100"
  >
    <line class="axis" x1="0" x2={W} y1={H / 2} y2={H / 2} />
    {#each form as v, i (i)}
      <rect
        class="bar"
        class:negative={v < 0}
        x={i * STEP_W + 2}
        width={STEP_W - 4}
        y={Math.min(y(v), H / 2)}
        height={Math.max(1, Math.abs(y(v) - H / 2))}
        role="slider"
        tabindex="0"
        aria-label="Pas {i + 1}"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={v}
        onkeydown={(e) => onkeydown(e, i)}
      />
    {/each}
    <path class="outline" d={outline} />
  </svg>
  <div class="presets">
    {#each PRESETS as p (p.label)}
      <button type="button" onclick={() => onchange(p.form())}>{p.label}</button>
    {/each}
  </div>
</div>

<style>
  .draw {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  svg {
    max-width: 100%;
    height: auto;
    background: var(--panel-track);
    border-radius: 8px;
    touch-action: none;
    cursor: crosshair;
  }
  .axis {
    stroke: var(--panel-tick);
  }
  .bar {
    fill: color-mix(in srgb, var(--accent) 45%, transparent);
    outline: none;
  }
  .bar.negative {
    fill: color-mix(in srgb, var(--focus) 45%, transparent);
  }
  .bar:focus-visible {
    stroke: var(--focus);
    stroke-width: 2;
  }
  .outline {
    fill: none;
    stroke: var(--panel-cap);
    stroke-width: 2;
    pointer-events: none;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  button {
    font: 0.72rem var(--sans);
    color: var(--panel-text);
    background: var(--panel-hover);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--focus);
  }
</style>
