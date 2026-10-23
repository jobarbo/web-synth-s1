<script lang="ts">
  import { formatParam, mapTempo, PARAMS, TEMPO_MAX, TEMPO_MIN, tempoToUnit, type ParamId } from '../dsp/params'
  import {
    BEND_MOTION,
    DEFAULT_STEP_NOTE,
    duplicatePattern,
    emptyStep,
    insertStep,
    MAX_MOTIONS,
    MAX_STEPS,
    MAX_SUB_STEPS,
    noteName,
    PAGE_SIZE,
    type Pattern,
    type Step,
  } from '../dsp/sequencer'
  import Slider from './Slider.svelte'

  interface Props {
    pattern: Pattern
    values: Record<ParamId, number>
    onchange: (id: ParamId, v: number) => void
    playing: boolean
    current: number
    onTransport: () => void
    /** Pas sélectionné pour l'édition (index absolu 0..63), -1 si aucun. */
    selected: number
    onSelect: (index: number) => void
    /** REC : saisie pas à pas à l'arrêt, enregistrement en temps réel (notes et motions) pendant la lecture. */
    rec: boolean
    onRec: (on: boolean) => void
    arpHold: boolean
    onArpHold: (on: boolean) => void
    /** Boucle de pas (vide = pattern entier). */
    loopSteps: number[]
    onLoop: (steps: number[]) => void
    /** Les 8 emplacements de motion sont pris (manuel : « FULL »). */
    motionFull: boolean
  }

  let {
    pattern = $bindable(),
    values,
    onchange,
    playing,
    current,
    onTransport,
    selected,
    onSelect,
    rec,
    onRec,
    arpHold,
    onArpHold,
    loopSteps,
    onLoop,
    motionFull,
  }: Props = $props()

  let page = $state(0)
  let loopMode = $state(false)
  let clipboard: Step | null = $state(null)
  const pages = $derived(Math.ceil(pattern.length / PAGE_SIZE))
  const def = (id: ParamId) => PARAMS.find((p) => p.id === id)!
  const labelOf = (param: string) => (param === BEND_MOTION ? 'Pitch bend' : (PARAMS.find((p) => p.id === param)?.label ?? param))
  const sectionOf = (param: string) => PARAMS.find((p) => p.id === param)?.section.toUpperCase() ?? ''

  // Suit le pas en lecture d'une page à l'autre
  $effect(() => {
    if (playing && current >= 0) page = Math.floor(current / PAGE_SIZE)
  })

  const tempo = $derived(mapTempo(values.tempo))
  const setTempo = (bpm: number) => onchange('tempo', tempoToUnit(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm))))

  function setLength(n: number) {
    pattern.length = Math.min(MAX_STEPS, Math.max(1, Math.round(n)))
    if (page >= Math.ceil(pattern.length / PAGE_SIZE)) page = 0
  }

  const setTranspose = (n: number) => (pattern.transpose = Math.min(60, Math.max(-60, Math.round(n))))

  function toggleLoopMode() {
    loopMode = !loopMode
    // Sortie de la boucle de pas : lecture du pattern entier (manuel : bouton PATTERN)
    if (!loopMode) onLoop([])
  }

  function clickStep(index: number) {
    if (loopMode) {
      onLoop(loopSteps.includes(index) ? loopSteps.filter((i) => i !== index) : [...loopSteps, index])
      return
    }
    // Pas vide : note par défaut et sélection. Pas plein : sélection, puis effacement au 2e clic.
    const step = pattern.steps[index]
    if (step.notes.length === 0) {
      step.notes.push({ note: lastNote(index), velocity: 100, gate: 50 })
      onSelect(index)
    } else if (selected === index) {
      pattern.steps[index] = emptyStep()
    } else {
      onSelect(index)
    }
  }

  // Une nouvelle note reprend la hauteur du pas plein le plus proche avant lui
  function lastNote(index: number) {
    for (let i = index - 1; i >= 0; i--) if (pattern.steps[i].notes.length) return pattern.steps[i].notes[0].note
    return DEFAULT_STEP_NOTE
  }

  const hasMotion = (index: number) => pattern.motions.some((m) => m.values[index] !== null)

  const step = $derived(selected >= 0 ? pattern.steps[selected] : null)
  const first = $derived(step?.notes[0])

  function transpose(semis: number) {
    if (!step) return
    for (const n of step.notes) n.note = Math.min(127, Math.max(0, n.note + semis))
  }

  // Le manuel : pour un accord, l'édition s'applique à toutes les notes du pas
  function setForAll(key: 'gate' | 'velocity', v: number) {
    if (!step) return
    for (const n of step.notes) n[key] = v
  }

  function setSubCount(count: number) {
    if (!step) return
    step.subSteps = Array.from({ length: count }, (_, i) => step.subSteps[i] ?? true)
  }

  const copyStep = (s: Step): Step => ({ ...s, notes: s.notes.map((n) => ({ ...n })), subSteps: [...s.subSteps] })

  const percentUnit = (v: number) => (v - 1) / 99
  const fromPercentUnit = (u: number) => Math.round(1 + u * 99)

  function clearNotes() {
    for (let i = 0; i < MAX_STEPS; i++) pattern.steps[i] = emptyStep()
  }

  function clearMotions() {
    pattern.motions = []
  }

  const deleteMotion = (param: string) => (pattern.motions = pattern.motions.filter((m) => m.param !== param))
  const paramMotionCount = $derived(pattern.motions.filter((m) => m.param !== BEND_MOTION).length)
</script>

<div class="sequencer">
  <div class="bar">
    <button type="button" class="play" class:on={playing} onclick={onTransport} aria-pressed={playing}>
      {playing ? '■ Stop' : '▶ Play'}
    </button>
    <button type="button" class="toggle rec" class:on={rec} onclick={() => onRec(!rec)} aria-pressed={rec}>● Rec</button>

    <div class="field">
      <span>Tempo</span>
      <button type="button" class="nudge" onclick={() => setTempo(tempo - 1)} aria-label="Tempo moins 1">−</button>
      <input
        type="number"
        min={TEMPO_MIN}
        max={TEMPO_MAX}
        step="0.1"
        value={tempo.toFixed(1)}
        onchange={(e) => setTempo(+e.currentTarget.value)}
        aria-label="Tempo en BPM"
      />
      <button type="button" class="nudge" onclick={() => setTempo(tempo + 1)} aria-label="Tempo plus 1">+</button>
    </div>

    <label class="field">
      <span>Longueur</span>
      <input type="number" min="1" max={MAX_STEPS} value={pattern.length} onchange={(e) => setLength(+e.currentTarget.value)} />
    </label>

    <label class="field">
      <span>Pas</span>
      <select value={Math.round(values.stepScale)} onchange={(e) => onchange('stepScale', +e.currentTarget.value)}>
        {#each def('stepScale').stepLabels! as label, i (i)}<option value={i}>{label}</option>{/each}
      </select>
    </label>

    <label class="field">
      <span>Shuffle {formatParam(def('shuffle'), values.shuffle)}</span>
      <input type="range" min="0" max="1" step={1 / 50} value={values.shuffle} oninput={(e) => onchange('shuffle', +e.currentTarget.value)} />
    </label>

    <span class="divider" aria-hidden="true"></span>

    <button type="button" class="toggle" class:on={Math.round(values.arpOn) === 1} onclick={() => onchange('arpOn', Math.round(values.arpOn) === 1 ? 0 : 1)} aria-pressed={Math.round(values.arpOn) === 1}>
      Arp
    </button>
    <label class="field">
      <span class="visually-hidden">Type d'arpège</span>
      <select value={Math.round(values.arpType)} onchange={(e) => onchange('arpType', +e.currentTarget.value)}>
        {#each def('arpType').stepLabels! as label, i (i)}<option value={i}>{label}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="visually-hidden">Vitesse d'arpège</span>
      <select value={Math.round(values.arpRate)} onchange={(e) => onchange('arpRate', +e.currentTarget.value)}>
        {#each def('arpRate').stepLabels! as label, i (i)}<option value={i}>{label}</option>{/each}
      </select>
    </label>
    <button type="button" class="toggle" class:on={arpHold} onclick={() => onArpHold(!arpHold)} aria-pressed={arpHold}>Hold</button>
  </div>

  <div class="bar">
    <div class="field">
      <span>Transp.</span>
      <button type="button" class="nudge" onclick={() => setTranspose(pattern.transpose - 1)} aria-label="Transposer d'un demi-ton plus bas">−</button>
      <output class="value">{pattern.transpose > 0 ? '+' : ''}{pattern.transpose}</output>
      <button type="button" class="nudge" onclick={() => setTranspose(pattern.transpose + 1)} aria-label="Transposer d'un demi-ton plus haut">+</button>
    </div>
    <label class="field">
      <span>Proba globale</span>
      <select value={pattern.masterProbability} onchange={(e) => (pattern.masterProbability = +e.currentTarget.value)}>
        {#each Array.from({ length: 21 }, (_, i) => i * 10 - 100) as v (v)}
          <option value={v}>{v > 0 ? '+' : ''}{v}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>Métronome</span>
      <select value={Math.round(values.metronome)} onchange={(e) => onchange('metronome', +e.currentTarget.value)}>
        {#each def('metronome').stepLabels! as label, i (i)}<option value={i}>{label}</option>{/each}
      </select>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={values.metronomeLevel}
        oninput={(e) => onchange('metronomeLevel', +e.currentTarget.value)}
        aria-label="Niveau du métronome"
      />
    </label>
    <label class="field">
      <span>Décompte</span>
      <select value={Math.round(values.countIn)} onchange={(e) => onchange('countIn', +e.currentTarget.value)}>
        {#each def('countIn').stepLabels! as label, i (i)}<option value={i}>{label}</option>{/each}
      </select>
    </label>
  </div>

  <div class="bar">
    <div class="pages" role="group" aria-label="Pages">
      {#each Array.from({ length: MAX_STEPS / PAGE_SIZE }, (_, i) => i) as p (p)}
        <button
          type="button"
          class:on={page === p}
          class:playing={playing && Math.floor(current / PAGE_SIZE) === p}
          disabled={p >= pages}
          onclick={() => (page = p)}
          aria-label="Pas {p * PAGE_SIZE + 1} à {(p + 1) * PAGE_SIZE}"
        >
          {p * PAGE_SIZE + 1}–{(p + 1) * PAGE_SIZE}
        </button>
      {/each}
    </div>
    <button type="button" class="toggle" class:on={loopMode} onclick={toggleLoopMode} aria-pressed={loopMode}>
      Loop{loopSteps.length ? ` (${loopSteps.length})` : ''}
    </button>
    <button type="button" class="plain" onclick={clearNotes}>Effacer les notes</button>
    <button type="button" class="plain" onclick={clearMotions} disabled={pattern.motions.length === 0}>Effacer les motions</button>
  </div>

  <div class="grid">
    {#each Array.from({ length: PAGE_SIZE }, (_, i) => page * PAGE_SIZE + i) as index (index)}
      {@const s = pattern.steps[index]}
      <button
        type="button"
        class="step"
        class:filled={s.notes.length > 0}
        class:current={playing && current === index}
        class:selected={selected === index && !loopMode}
        class:looped={loopSteps.includes(index)}
        class:beyond={index >= pattern.length}
        onclick={() => clickStep(index)}
        aria-label="Pas {index + 1}{s.notes.length ? ', ' + s.notes.map((n) => noteName(n.note)).join(' ') : ', vide'}{hasMotion(index) ? ', motion' : ''}"
        aria-pressed={loopMode ? loopSteps.includes(index) : selected === index}
      >
        <span class="num">{index + 1}</span>
        <span class="notes">
          {#if s.notes.length}{noteName(s.notes[0].note)}{#if s.notes.length > 1}<small>+{s.notes.length - 1}</small>{/if}{/if}
        </span>
        <span class="marks">
          {#if s.probability < 100}<small>{s.probability}%</small>{/if}
          {#if s.subSteps.length > 1}<small>×{s.subSteps.length}</small>{/if}
          {#if s.tie}<small>⌒</small>{/if}
          {#if hasMotion(index)}<small class="motion-dot" title="Motion">●</small>{/if}
        </span>
      </button>
    {/each}
  </div>

  {#if loopMode}
    <p class="hint">Boucle de pas : clic sur les pas à rejouer en boucle (plusieurs possibles). Re-cliquer sur Loop pour revenir au pattern entier.</p>
  {:else if step && first}
    <div class="editor" aria-label="Pas {selected + 1}">
      <div class="note-edit">
        <span class="label">Pas {selected + 1}</span>
        <output>{step.notes.map((n) => noteName(n.note)).join(' ')}</output>
        <div class="nudges">
          <button type="button" onclick={() => transpose(-12)} aria-label="Octave plus bas">−oct</button>
          <button type="button" onclick={() => transpose(-1)} aria-label="Demi-ton plus bas">−</button>
          <button type="button" onclick={() => transpose(1)} aria-label="Demi-ton plus haut">+</button>
          <button type="button" onclick={() => transpose(12)} aria-label="Octave plus haut">+oct</button>
        </div>
        <button type="button" class="toggle" class:on={step.tie} onclick={() => (step.tie = !step.tie)} aria-pressed={step.tie}>Tie</button>
      </div>

      <Slider
        label="Gate"
        value={percentUnit(Math.max(...step.notes.map((n) => n.gate)))}
        defaultValue={percentUnit(50)}
        display={`${Math.max(...step.notes.map((n) => n.gate))}`}
        steps={100}
        onchange={(u) => setForAll('gate', fromPercentUnit(u))}
      />
      <Slider
        label="Vélocité"
        value={(Math.max(...step.notes.map((n) => n.velocity)) - 1) / 126}
        defaultValue={99 / 126}
        display={`${Math.max(...step.notes.map((n) => n.velocity))}`}
        steps={127}
        onchange={(u) => setForAll('velocity', Math.round(1 + u * 126))}
      />
      <Slider
        label="Proba"
        value={percentUnit(step.probability)}
        defaultValue={1}
        display={`${step.probability} %`}
        steps={100}
        onchange={(u) => (step.probability = fromPercentUnit(u))}
      />

      <div class="subs">
        <span class="label">Sub-steps</span>
        <div class="nudges">
          {#each Array.from({ length: MAX_SUB_STEPS }, (_, i) => i + 1) as count (count)}
            <button type="button" class:on={step.subSteps.length === count} onclick={() => setSubCount(count)}>{count}</button>
          {/each}
        </div>
        {#if step.subSteps.length > 1}
          <div class="parts">
            {#each step.subSteps as part, i (i)}
              <button
                type="button"
                class:on={part}
                onclick={() => (step.subSteps[i] = !part)}
                aria-pressed={part}
                aria-label="Partie {i + 1} {part ? 'jouée' : 'muette'}"
              ></button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="subs">
        <span class="label">Pas</span>
        <div class="nudges wrap">
          <button type="button" onclick={() => (clipboard = copyStep(step))}>Copier</button>
          <button type="button" disabled={!clipboard} onclick={() => clipboard && (pattern.steps[selected] = copyStep(clipboard))}>Coller</button>
          <button type="button" onclick={() => insertStep(pattern, selected)}>Insérer</button>
          <button type="button" disabled={pattern.length * 2 > MAX_STEPS} onclick={() => duplicatePattern(pattern)}>Doubler</button>
        </div>
      </div>
    </div>
  {:else}
    <p class="hint">
      Clic sur un pas vide : ajoute une note. Clic sur un pas plein : le sélectionne ; deuxième clic : l'efface.
      Avec Rec à l'arrêt, les notes jouées s'écrivent dans le pas sélectionné, puis la sélection avance.
      Avec Rec pendant la lecture, les notes et les mouvements de sliders s'enregistrent sur le pas en cours.
    </p>
  {/if}

  {#if pattern.motions.length > 0 || motionFull}
    <div class="motions">
      <span class="label">Motions {paramMotionCount}/{MAX_MOTIONS}</span>
      {#if motionFull}<span class="full" role="status">FULL : effacer une motion pour en enregistrer une autre</span>{/if}
      {#each pattern.motions as m (m.param)}
        <span class="chip">
          <small>{sectionOf(m.param)}</small>
          {labelOf(m.param)}
          <button type="button" onclick={() => deleteMotion(m.param)} aria-label="Effacer la motion {labelOf(m.param)}">×</button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sequencer {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    padding: 12px 14px;
    display: grid;
    gap: 10px;
    color: var(--panel-text);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 0.7rem var(--mono);
    color: var(--panel-text-muted);
  }
  .value {
    font: 0.8rem var(--mono);
    color: var(--panel-text);
    min-width: 2.2em;
    text-align: center;
  }
  input[type='number'],
  select {
    font: 0.8rem var(--mono);
    color: var(--panel-text);
    background: var(--panel-track);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 6px;
  }
  input[type='number'] {
    width: 4.5em;
  }
  input[type='range'] {
    width: 90px;
    accent-color: var(--accent);
  }
  button {
    font: 0.75rem var(--sans);
    color: var(--panel-text);
    background: var(--panel-hover);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--panel-track);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .play {
    font-weight: 700;
    min-width: 76px;
  }
  .play.on,
  .toggle.on,
  .pages button.on,
  .nudges button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .rec.on {
    animation: blink 1s steps(2, start) infinite;
  }
  .nudge {
    padding: 3px 8px;
  }
  .plain {
    background: none;
  }
  .divider {
    width: 1px;
    align-self: stretch;
    background: var(--panel-border);
  }
  .pages {
    display: flex;
    gap: 4px;
  }
  .pages button.playing:not(.on) {
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 4px;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 2px;
    min-height: 58px;
    min-width: 0;
    background: var(--panel-track);
    border-radius: 6px;
  }
  .step.filled {
    background: color-mix(in srgb, var(--accent) 35%, var(--panel-track));
  }
  .step.selected {
    outline: 2px solid var(--panel-cap);
    outline-offset: -2px;
  }
  .step.looped {
    border-color: var(--focus);
    box-shadow: inset 0 -3px 0 var(--focus);
  }
  .step.current {
    box-shadow: 0 0 0 2px var(--accent), 0 0 10px var(--accent);
  }
  .step.beyond {
    opacity: 0.3;
  }
  .num {
    font: 0.6rem var(--mono);
    color: var(--panel-text-muted);
  }
  .notes {
    font: 600 0.72rem var(--mono);
    white-space: nowrap;
  }
  .marks {
    display: flex;
    gap: 2px;
    font: 0.55rem var(--mono);
    color: var(--panel-text-muted);
  }
  .motion-dot {
    color: var(--focus);
  }
  .editor {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--panel-border);
  }
  .note-edit,
  .subs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-self: center;
  }
  .note-edit output {
    font: 700 1.1rem var(--mono);
  }
  .label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--accent);
  }
  .nudges,
  .parts {
    display: flex;
    gap: 4px;
  }
  .nudges.wrap {
    flex-wrap: wrap;
    max-width: 220px;
  }
  .parts button {
    width: 22px;
    height: 22px;
    padding: 0;
  }
  .parts button.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .motions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--panel-border);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: var(--panel-track);
    border: 1px solid var(--panel-border);
  }
  .chip small {
    font: 0.58rem var(--mono);
    color: var(--panel-text-muted);
  }
  .chip button {
    padding: 0 6px;
    border-radius: 999px;
    border: none;
  }
  .full {
    font: 0.72rem var(--mono);
    color: var(--danger);
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--panel-text-muted);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @keyframes blink {
    50% {
      opacity: 0.6;
    }
  }
  @media (max-width: 640px) {
    .grid {
      grid-template-columns: repeat(8, minmax(0, 1fr));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rec.on {
      animation: none;
    }
  }
</style>
