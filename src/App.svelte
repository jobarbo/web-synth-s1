<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { Engine } from './audio/engine'
  import { attachKeyboard, MAX_OCTAVE, MIN_OCTAVE } from './audio/keyboard'
  import type { MidiEvent } from './audio/midi'
  import { exportPrm, importPrm } from './audio/prm'
  import { CHOP_NONE, INIT_DRAW_FORM } from './dsp/draw'
  import { defaultParams, DMotionTarget, PARAMS, type ParamId, type Section } from './dsp/params'
  import { BEND_MOTION, emptyMotionValues, emptyPattern, MAX_MOTIONS, MAX_NOTES_PER_STEP } from './dsp/sequencer'
  import Drawers from './ui/Drawers.svelte'
  import MidiBar from './ui/MidiBar.svelte'
  import Panel from './ui/Panel.svelte'
  import PianoKeyboard from './ui/PianoKeyboard.svelte'
  import PrmBar from './ui/PrmBar.svelte'
  import Scope from './ui/Scope.svelte'
  import Sequencer from './ui/Sequencer.svelte'

  let engine: Engine | null = $state(null)
  let powered = $state(false)
  let octave = $state(0)
  let error = $state('')
  const values = $state(defaultParams())
  const held = new SvelteSet<number>()
  let bend = $state(0)
  let mod = $state(0)

  // Séquenceur
  let pattern = $state(emptyPattern())
  let playing = $state(false)
  let currentStep = $state(-1)
  let selectedStep = $state(-1)
  let rec = $state(false)
  let arpHold = $state(false)
  let loopSteps: number[] = $state([])
  let motionFull = $state(false)

  // Forme OSC DRAW et motifs OSC CHOP (valeurs INIT de la machine)
  let drawForm = $state([...INIT_DRAW_FORM])
  let chopMasks = $state([CHOP_NONE, CHOP_NONE, CHOP_NONE, CHOP_NONE])

  // Pan et expression : MIDI (CC10, CC11) combinés aux décalages de D-MOTION
  let midiPan = 0
  let midiExpression = 1
  let dm = { pan: 0, expression: 1 }
  /** Touches tenues pendant la saisie : un nouvel accord commence quand tout a été relâché. */
  let entryHeld = 0
  let entryWrote = false

  async function togglePower() {
    error = ''
    try {
      if (!powered) {
        engine ??= new Engine()
        engine.onStep = onStep
        engine.onRecNote = onRecNote
        await engine.start($state.snapshot(values))
        engine.setPattern($state.snapshot(pattern))
        engine.arpHold(arpHold)
        engine.recording(rec)
        engine.stepLoop($state.snapshot(loopSteps))
        engine.setWave($state.snapshot(drawForm), $state.snapshot(chopMasks))
        powered = true
      } else {
        await engine?.stop()
        held.clear()
        engine?.transport(false)
        playing = false
        currentStep = -1
        powered = false
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  function update(id: ParamId, v: number) {
    values[id] = v
    engine?.setParam(id, v)
  }

  // Motion : seuls les réglages continus du son et des effets s'enregistrent, comme les potards de la machine
  const MOTION_SECTIONS = new Set<Section>(['voice', 'lfo', 'osc', 'mixer', 'filter', 'env', 'amp', 'ctrl', 'delay', 'reverb'])
  const MOTION_PARAMS = new Set(PARAMS.filter((p) => MOTION_SECTIONS.has(p.section) && !p.steps).map((p) => p.id))

  /** Pas où enregistrer une motion : le pas en cours pendant la lecture, sinon le pas sélectionné. */
  const motionTarget = () => (playing ? currentStep : selectedStep)

  function recordMotion(param: string, v: number) {
    const target = motionTarget()
    if (!rec || target < 0) return
    let motion = pattern.motions.find((m) => m.param === param)
    if (!motion) {
      // Manuel : 8 paramètres maximum, plus le pitch bend
      const count = pattern.motions.filter((m) => m.param !== BEND_MOTION).length
      if (param !== BEND_MOTION && count >= MAX_MOTIONS) {
        motionFull = true
        return
      }
      pattern.motions.push({ param, values: emptyMotionValues() })
      motion = pattern.motions[pattern.motions.length - 1]
    }
    motion.values[target] = v
  }

  /** Réglage fait par l'utilisateur (panneau, tiroirs, MIDI) : appliqué, et enregistré en motion si REC. */
  function userUpdate(id: ParamId, v: number) {
    update(id, v)
    if (MOTION_PARAMS.has(id)) recordMotion(id, v)
  }

  /** Lecture : chaque pas rejoue les motions enregistrées, les sliders suivent. */
  function onStep(index: number) {
    currentStep = index
    for (const m of pattern.motions) {
      const v = m.values[index]
      if (v === null) continue
      if (m.param === BEND_MOTION) {
        bend = v
        engine?.pitchBend(v)
      } else update(m.param as ParamId, v)
    }
  }

  /** Note enregistrée en temps réel par le worklet : ajoutée au pattern (ou son gate mis à jour). */
  function onRecNote(step: number, note: number, gate: number) {
    const s = pattern.steps[step]
    const existing = s.notes.find((n) => n.note === note)
    if (existing) existing.gate = gate
    else if (s.notes.length < MAX_NOTES_PER_STEP) s.notes.push({ note, velocity: 100, gate })
  }

  function setWave(form: number[], masks: number[]) {
    drawForm = form
    chopMasks = masks
    engine?.setWave(form, masks)
  }

  /** Dernier .PRM importé : base de l'export, pour conserver ce que l'app ne modélise pas. */
  let prmBase: string | undefined

  function importPatch(text: string) {
    const r = importPrm(text)
    for (const [id, v] of Object.entries(r.values)) update(id as ParamId, v)
    pattern = r.pattern
    setWave(r.drawForm, r.chopMasks)
    setLoop([])
    selectedStep = -1
    prmBase = text
    return r.warnings
  }

  const exportPatch = () =>
    exportPrm(
      {
        values: $state.snapshot(values),
        pattern: $state.snapshot(pattern),
        drawForm: $state.snapshot(drawForm),
        chopMasks: $state.snapshot(chopMasks),
      },
      prmBase,
    )

  function applyPanExpression() {
    engine?.setPan(Math.max(-1, Math.min(1, midiPan + dm.pan)))
    engine?.setExpression(midiExpression * dm.expression)
  }

  /**
   * D-MOTION : chaque axe agit sur sa cible (manuel, Configuring D-MOTION), dosé par sa sensibilité.
   * Tout revient au réglage d'origine quand le pad est relâché (x = y = 0).
   */
  function dmotion(x: number, y: number) {
    const amounts = new Map<number, number>()
    for (const [axis, target, sens] of [
      [x, values.dmX, values.dmSensX],
      [y, values.dmY, values.dmSensY],
    ]) {
      const t = Math.round(target)
      if (t !== DMotionTarget.Off) amounts.set(t, (amounts.get(t) ?? 0) + axis * (sens / 10))
    }
    const a = (t: number) => amounts.get(t) ?? 0
    // Modulation et bend : la molette et le bend joués reprennent la main au relâchement
    engine?.modWheel(amounts.has(DMotionTarget.Mod) ? Math.min(1, Math.abs(a(DMotionTarget.Mod))) : mod)
    engine?.pitchBend(amounts.has(DMotionTarget.Bend) ? Math.max(-1, Math.min(1, a(DMotionTarget.Bend))) : bend)
    // Freq / Reso / niveaux d'effets : autour du réglage courant (cutoff ±3 octaves, résonance et niveaux ±50 %)
    engine?.perf(a(DMotionTarget.Freq) * 3, a(DMotionTarget.Reso) * 0.5, a(DMotionTarget.DelayLevel) * 0.5, a(DMotionTarget.ReverbLevel) * 0.5)
    // Expression : seulement vers le bas (manuel)
    dm = { pan: a(DMotionTarget.Pan), expression: 1 + Math.min(0, a(DMotionTarget.Expression)) }
    applyPanExpression()
  }

  function setRec(on: boolean) {
    rec = on
    engine?.recording(on)
  }

  function setLoop(steps: number[]) {
    loopSteps = steps
    engine?.stepLoop(steps)
  }

  // Le message FULL disparaît dès qu'une motion est effacée
  $effect(() => {
    if (pattern.motions.filter((m) => m.param !== BEND_MOTION).length < MAX_MOTIONS) motionFull = false
  })

  // Jouer une note sert aussi de geste utilisateur pour démarrer l'audio.
  // Démarrage partagé : plusieurs notes simultanées ne lancent qu'une seule initialisation.
  let starting: Promise<void> | null = null

  async function ensurePower() {
    if (!powered) await (starting ??= togglePower().finally(() => (starting = null)))
  }

  /** Saisie pas à pas : les notes tenues ensemble forment un accord (4 notes max, comme la polyphonie). */
  function recordNote(note: number) {
    const step = pattern.steps[selectedStep]
    if (entryHeld === 0) step.notes = []
    if (step.notes.length < MAX_NOTES_PER_STEP && !step.notes.some((n) => n.note === note)) {
      step.notes.push({ note, velocity: 100, gate: 50 })
    }
    entryHeld++
    entryWrote = true
  }

  async function noteOn(note: number) {
    // Saisie pas à pas : REC à l'arrêt. Pendant la lecture, c'est le worklet qui enregistre (temps réel).
    if (rec && !playing && selectedStep >= 0) recordNote(note)
    held.add(note)
    await ensurePower()
    if (held.has(note)) engine?.noteOn(note)
  }

  function noteOff(note: number) {
    held.delete(note)
    engine?.noteOff(note)
    if (entryHeld > 0 && --entryHeld === 0 && entryWrote) {
      // Accord relâché : la sélection passe au pas suivant, dans la longueur du pattern
      entryWrote = false
      selectedStep = (selectedStep + 1) % pattern.length
    }
  }

  async function toggleTransport() {
    await ensurePower()
    playing = !playing
    engine?.transport(playing)
    if (!playing) currentStep = -1
  }

  function setArpHold(on: boolean) {
    arpHold = on
    engine?.arpHold(on)
  }

  // Chaque édition du pattern est renvoyée au worklet
  $effect(() => {
    const snapshot = $state.snapshot(pattern)
    if (powered) engine?.setPattern(snapshot)
  })

  function setBend(v: number) {
    bend = v
    engine?.pitchBend(v)
    recordMotion(BEND_MOTION, v)
  }

  function setMod(v: number) {
    mod = v
    engine?.modWheel(v)
  }

  function onMidi(e: MidiEvent) {
    switch (e.type) {
      case 'noteOn':
        return noteOn(e.note)
      case 'noteOff':
        return noteOff(e.note)
      case 'pitchBend':
        return setBend(e.value)
      case 'modWheel':
        return setMod(e.value)
      case 'hold':
        return engine?.hold(e.on)
      case 'allNotesOff':
        held.clear()
        return engine?.allNotesOff()
      case 'param':
        return userUpdate(e.id, e.value)
      case 'pan':
        midiPan = e.value
        return applyPanExpression()
      case 'expression':
        midiExpression = e.value
        return applyPanExpression()
    }
  }

  function setOctave(o: number) {
    octave = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, o))
  }

  $effect(() =>
    attachKeyboard({
      noteOn,
      noteOff,
      getOctave: () => octave,
      setOctave,
    }),
  )
</script>

<main>
  <header>
    <h1>S1 Web <span>prototype phase 6</span></h1>
    <PrmBar onImport={importPatch} onExport={exportPatch} />
    <MidiBar onEvent={onMidi} />
    <button class="power" class:on={powered} onclick={togglePower} aria-pressed={powered}>
      {powered ? 'On' : 'Power'}
    </button>
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  <Scope analyser={engine?.analyser ?? null} />

  <Panel {values} onchange={userUpdate} />

  <Drawers {values} onchange={userUpdate} {drawForm} {chopMasks} onWave={setWave} onMotion={dmotion} />

  <Sequencer
    bind:pattern
    {values}
    onchange={update}
    {playing}
    current={currentStep}
    onTransport={toggleTransport}
    selected={selectedStep}
    onSelect={(i) => (selectedStep = i)}
    {rec}
    onRec={setRec}
    {arpHold}
    onArpHold={setArpHold}
    {loopSteps}
    onLoop={setLoop}
    {motionFull}
  />

  <PianoKeyboard {octave} {held} {noteOn} {noteOff} {setOctave} {bend} {mod} onBend={setBend} onMod={setMod} />

  <p class="hint">
    Jouer au clavier à l'écran (souris ou tactile, glissando possible) ou avec la rangée du milieu du clavier d'ordinateur
    (A S D F G H J K L, dièses sur W E T Y U O P en QWERTY). Octave : touches Z / X en QWERTY (W / X en AZERTY).
    Contrôles : glisser verticalement ou molette, Shift pour le réglage fin, double-clic pour la valeur par défaut,
    flèches au clavier quand un contrôle a le focus. Bend revient au centre au relâchement ; Mod reste en place.
  </p>
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: grid;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  header h1 {
    margin-right: auto;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
    letter-spacing: 0.04em;
  }
  h1 span {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--text-muted);
    margin-left: 8px;
  }
  .power {
    font: inherit;
    padding: 8px 20px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  .power.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .error {
    color: var(--danger);
    margin: 0;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
  }
</style>
