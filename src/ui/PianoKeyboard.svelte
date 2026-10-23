<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity'
  import { BASE_NOTE, MAX_OCTAVE, MIN_OCTAVE } from '../audio/keyboard'
  import WheelStrip from './WheelStrip.svelte'

  interface Props {
    octave: number
    held: SvelteSet<number>
    noteOn: (note: number) => void
    noteOff: (note: number) => void
    setOctave: (octave: number) => void
    bend: number
    mod: number
    onBend: (v: number) => void
    onMod: (v: number) => void
  }

  let { octave, held, noteOn, noteOff, setOctave, bend, mod, onBend, onMod }: Props = $props()

  const OCTAVES = 2
  const BLACK = new Set([1, 3, 6, 8, 10])
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  // 2 octaves + le do du haut. Les touches noires sont positionnées entre deux blanches.
  const keys = $derived.by(() => {
    const first = BASE_NOTE + 12 * octave
    const out: { note: number; black: boolean; whiteIndex: number; name: string }[] = []
    let whiteIndex = 0
    for (let i = 0; i <= OCTAVES * 12; i++) {
      const note = first + i
      const black = BLACK.has(i % 12)
      out.push({ note, black, whiteIndex: black ? whiteIndex - 1 : whiteIndex, name: NAMES[note % 12] + (Math.floor(note / 12) - 1) })
      if (!black) whiteIndex++
    }
    return out
  })
  const whiteCount = $derived(keys.filter((k) => !k.black).length)

  // Une note par pointeur : multi-touch et glissando d'une touche à l'autre
  const active = new Map<number, number>()

  function noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const n = el?.closest<HTMLElement>('[data-note]')?.dataset.note
    return n === undefined ? null : Number(n)
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const note = noteAt(e.clientX, e.clientY)
    if (note === null) return
    e.preventDefault()
    // La capture peut échouer (pointeur déjà relâché) : la note doit partir quand même
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {}
    active.set(e.pointerId, note)
    noteOn(note)
  }

  function onpointermove(e: PointerEvent) {
    const current = active.get(e.pointerId)
    if (current === undefined) return
    const note = noteAt(e.clientX, e.clientY)
    if (note === null || note === current) return
    // Nouvelle note avant de relâcher l'ancienne : legato en mono
    active.set(e.pointerId, note)
    noteOn(note)
    noteOff(current)
  }

  function release(e: PointerEvent) {
    const current = active.get(e.pointerId)
    if (current === undefined) return
    active.delete(e.pointerId)
    noteOff(current)
  }
</script>

<div class="keyboard">
  <div class="wheels">
    <WheelStrip label="Bend" value={bend} bipolar springBack onchange={onBend} />
    <WheelStrip label="Mod" value={mod} onchange={onMod} />
  </div>
  <div class="octave" role="group" aria-label="Octave">
    <button type="button" onclick={() => setOctave(octave - 1)} disabled={octave <= MIN_OCTAVE} aria-label="Octave plus bas">−</button>
    <output aria-live="polite">Oct {octave > 0 ? '+' : ''}{octave}</output>
    <button type="button" onclick={() => setOctave(octave + 1)} disabled={octave >= MAX_OCTAVE} aria-label="Octave plus haut">+</button>
  </div>

  <div
    class="keys"
    style:--whites={whiteCount}
    role="group"
    aria-label="Clavier"
    {onpointerdown}
    {onpointermove}
    onpointerup={release}
    onpointercancel={release}
  >
    {#each keys as k (k.note)}
      <div
        class="key"
        class:black={k.black}
        class:down={held.has(k.note)}
        data-note={k.note}
        style:--i={k.whiteIndex}
        aria-hidden="true"
      >
        {#if !k.black && k.note % 12 === 0}<span>{k.name}</span>{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .keyboard {
    display: flex;
    gap: 10px;
    align-items: stretch;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    padding: 10px;
  }
  .wheels {
    display: flex;
    gap: 6px;
  }
  .octave {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .octave button {
    all: unset;
    width: 32px;
    height: 28px;
    text-align: center;
    border-radius: 6px;
    background: var(--panel-hover);
    color: var(--panel-text);
    cursor: pointer;
    font-size: 1.1rem;
  }
  .octave button:hover:not(:disabled) {
    background: var(--panel-track);
  }
  .octave button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .octave button:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  .octave output {
    font: 0.68rem var(--mono);
    color: var(--panel-text-muted);
    white-space: nowrap;
  }
  .keys {
    position: relative;
    flex: 1;
    height: 120px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    --w: calc(100% / var(--whites));
  }
  .key {
    position: absolute;
    top: 0;
    left: calc(var(--i) * var(--w));
    width: var(--w);
    height: 100%;
    box-sizing: border-box;
    background: var(--key-white);
    border: 1px solid var(--key-edge);
    border-radius: 0 0 5px 5px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 6px;
    cursor: pointer;
  }
  .key span {
    font: 0.6rem var(--mono);
    color: var(--key-label);
    pointer-events: none;
  }
  .key.black {
    left: calc((var(--i) + 1) * var(--w) - var(--w) * 0.3);
    width: calc(var(--w) * 0.6);
    height: 62%;
    background: var(--key-black);
    border-color: var(--key-black);
    z-index: 1;
  }
  .key.down {
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
