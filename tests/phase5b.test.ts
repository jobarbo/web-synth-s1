import { describe, expect, it } from 'vitest'
import {
  duplicatePattern,
  effectiveProbability,
  emptyMotionValues,
  emptyPattern,
  emptyStep,
  insertStep,
  MetronomeMode,
  SequencerClock,
  stepSamples,
  type NoteSink,
} from '../src/dsp/sequencer'

const SR = 48000
const LEN = stepSamples(120, 1, SR) // 1/16 à 120 BPM = 6000 échantillons
const BEAT = SR / 2 // noire à 120 BPM

function setup(configure: (c: SequencerClock, now: () => number) => void = () => {}) {
  const events: { t: number; note: number; on: boolean }[] = []
  const clicks: { t: number; accent: boolean }[] = []
  let t = 0
  const sink: NoteSink = {
    noteOn: (note) => events.push({ t, note, on: true }),
    noteOff: (note) => events.push({ t, note, on: false }),
  }
  const clock = new SequencerClock(sink, SR)
  clock.tempo = 120
  clock.scale = 1
  clock.onClick = (accent) => clicks.push({ t, accent })
  configure(clock, () => t)
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock.tick()
      t++
    }
  }
  return { clock, events, clicks, run }
}

const note = (n: number, gate = 50) => ({ note: n, velocity: 100, gate })

describe('Enregistrement en temps réel', () => {
  it('quantifie au pas le plus proche', () => {
    const { clock, run } = setup((c) => (c.recording = true))
    clock.start()
    run(LEN * 2 + LEN * 0.2) // 20 % dans le pas 3 (index 2)
    expect(clock.recordNoteOn(60)!.step).toBe(2)
    run(LEN * 0.5) // 70 % dans le pas 3 → pas suivant
    expect(clock.recordNoteOn(62)!.step).toBe(3)
  })

  it('n’enregistre que si REC est actif pendant la lecture', () => {
    const { clock, run } = setup()
    clock.start()
    run(100)
    expect(clock.recordNoteOn(60)).toBeNull()
  })

  it('le gate vient de la durée tenue, plafonné à 100', () => {
    const { clock, run } = setup((c) => (c.recording = true))
    clock.start()
    run(10)
    clock.recordNoteOn(60)
    run(LEN * 0.3)
    expect(clock.recordNoteOff(60)!.gate).toBe(30)
    clock.recordNoteOn(64)
    run(LEN * 3)
    expect(clock.recordNoteOff(64)!.gate).toBe(100)
  })

  it('une note quantifiée au pas suivant n’est pas rejouée une 2e fois à ce pas', () => {
    const { clock, events, run } = setup((c) => {
      c.recording = true
      c.pattern = emptyPattern(4)
    })
    clock.start()
    run(LEN * 0.8)
    clock.recordNoteOn(60) // → pas 2 (index 1), déjà joué en direct
    run(LEN * 0.4)
    expect(events.filter((e) => e.on)).toEqual([])
    // Au tour suivant, la note enregistrée est bien jouée
    run(LEN * 4)
    expect(events.filter((e) => e.on).map((e) => e.t)).toEqual([LEN * 5])
  })
})

describe('Boucle de pas', () => {
  it('rejoue seulement les pas choisis, dans l’ordre', () => {
    const seen: number[] = []
    const { clock, run } = setup((c) => {
      c.pattern = emptyPattern(16)
      c.loopSteps = [2, 5, 9]
      c.onStep = (i) => seen.push(i)
    })
    clock.start()
    run(LEN * 6)
    expect(seen).toEqual([2, 5, 9, 2, 5, 9])
  })
})

describe('Probabilité globale et transposition', () => {
  it('s’ajoute aux pas à 99 % ou moins, sans toucher les pas à 100 %', () => {
    const step = { ...emptyStep(), probability: 50 }
    expect(effectiveProbability(step, 30)).toBe(80)
    expect(effectiveProbability(step, -100)).toBe(0)
    expect(effectiveProbability({ ...step, probability: 100 }, -100)).toBe(100)
  })

  it('transpose les notes du séquenceur, relâche la note transposée', () => {
    const { clock, events, run } = setup((c) => {
      c.pattern = emptyPattern(4)
      c.pattern.transpose = 7
      c.pattern.steps[0].notes.push(note(60))
    })
    clock.start()
    run(LEN)
    expect(events).toEqual([
      { t: 0, note: 67, on: true },
      { t: LEN / 2, note: 67, on: false },
    ])
  })
})

describe('Métronome et décompte', () => {
  it('Rec&Play : un clic par noire, accent au début du pattern', () => {
    const { clock, clicks, run } = setup((c) => {
      c.pattern = emptyPattern(16)
      c.metronome = MetronomeMode.RecPlay
    })
    clock.start()
    run(BEAT * 4 + 10)
    expect(clicks.map((c) => c.t)).toEqual([0, BEAT, BEAT * 2, BEAT * 3, BEAT * 4])
    // 16 pas de 1/16 = 4 temps : le pattern recommence au 5e clic, qui est donc accentué
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false, true])
  })

  it('Rec : silencieux en simple lecture', () => {
    const { clock, clicks, run } = setup((c) => (c.metronome = MetronomeMode.Rec))
    clock.start()
    run(BEAT * 2)
    expect(clicks).toEqual([])
  })

  it('décompte de 4 temps avant d’enregistrer, puis le pas 1', () => {
    const steps: { t: number; i: number }[] = []
    const { clock, clicks, run } = setup((c, now) => {
      c.recording = true
      c.countIn = 4
      c.onStep = (i) => steps.push({ t: now(), i })
    })
    clock.start()
    run(BEAT * 4 + 10)
    expect(clicks.slice(0, 4).map((c) => c.t)).toEqual([0, BEAT, BEAT * 2, BEAT * 3])
    expect(steps[0]).toEqual({ t: BEAT * 4, i: 0 })
  })
})

describe('Édition du pattern', () => {
  it('Insérer décale les pas et les motions, et allonge le pattern', () => {
    const p = emptyPattern(4)
    p.steps[1].notes.push(note(60))
    p.motions.push({ param: 'cutoff', values: emptyMotionValues() })
    p.motions[0].values[1] = 0.5
    insertStep(p, 1)
    expect(p.steps[1].notes).toEqual([])
    expect(p.steps[2].notes[0].note).toBe(60)
    expect(p.motions[0].values[2]).toBe(0.5)
    expect(p.length).toBe(5)
    expect(p.steps.length).toBe(64)
  })

  it('Doubler recopie les pas et les motions à la suite', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60))
    p.motions.push({ param: 'cutoff', values: emptyMotionValues() })
    p.motions[0].values[3] = 0.2
    duplicatePattern(p)
    expect(p.length).toBe(8)
    expect(p.steps[4].notes[0].note).toBe(60)
    expect(p.motions[0].values[7]).toBe(0.2)
    // Copie indépendante
    p.steps[4].notes[0].note = 72
    expect(p.steps[0].notes[0].note).toBe(60)
  })
})
