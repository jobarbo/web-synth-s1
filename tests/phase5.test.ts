import { describe, expect, it } from 'vitest'
import { EnvTrigger, PortaMode, VoiceAllocator, VoiceMode } from '../src/dsp/allocator'
import { ArpType, Arpeggiator, arpSequence } from '../src/dsp/arpeggiator'
import { defaultParams, delaySyncTime, formatParam, lfoSyncHz, mapTempo, PARAMS } from '../src/dsp/params'
import { emptyPattern, noteName, SequencerClock, stepSamples, type NoteSink, type Pattern } from '../src/dsp/sequencer'
import { Voice } from '../src/dsp/voice'

const SR = 48000

interface Event {
  t: number
  note: number
  on: boolean
}

function recorder() {
  const events: Event[] = []
  let t = 0
  const sink: NoteSink = {
    noteOn: (note) => events.push({ t, note, on: true }),
    noteOff: (note) => events.push({ t, note, on: false }),
  }
  return { events, sink, advance: () => t++ }
}

function runSeq(pattern: Pattern, samples: number, setup: (c: SequencerClock) => void = () => {}) {
  const r = recorder()
  const clock = new SequencerClock(r.sink, SR)
  clock.pattern = pattern
  clock.tempo = 120
  clock.scale = 1
  setup(clock)
  clock.start()
  for (let i = 0; i < samples; i++) {
    clock.tick()
    r.advance()
  }
  return { events: r.events, clock }
}

const LEN = stepSamples(120, 1, SR) // 1/16 à 120 BPM = 6000 échantillons

function note(note: number, gate = 50) {
  return { note, velocity: 100, gate }
}

describe('SequencerClock', () => {
  it('place chaque pas à l’échantillon près, sans dérive sur 10 minutes', () => {
    const p = emptyPattern(16)
    for (const s of p.steps) s.notes.push(note(60))
    const { events } = runSeq(p, SR * 600 + 10)
    const ons = events.filter((e) => e.on)
    expect(ons.length).toBe(4801)
    for (const [k, e] of ons.entries()) expect(Math.abs(e.t - k * LEN)).toBeLessThanOrEqual(1)
  })

  it('gate : la note dure le pourcentage demandé du pas', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60, 25))
    const { events } = runSeq(p, LEN * 2)
    expect(events).toEqual([
      { t: 0, note: 60, on: true },
      { t: LEN / 4, note: 60, on: false },
    ])
  })

  it('tie : la note couvre aussi le pas suivant vide, sans nouvelle attaque', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60))
    p.steps[0].tie = true
    const { events } = runSeq(p, LEN * 3)
    expect(events).toEqual([
      { t: 0, note: 60, on: true },
      { t: LEN * 2, note: 60, on: false },
    ])
  })

  it('gate 100 sur la même note au pas suivant : liaison, une seule attaque', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60, 100))
    p.steps[1].notes.push(note(60, 50))
    const { events } = runSeq(p, LEN * 3)
    expect(events).toEqual([
      { t: 0, note: 60, on: true },
      { t: LEN * 1.5, note: 60, on: false },
    ])
  })

  it('gate 100 vers une autre note : la suivante démarre avant le relâchement (legato)', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60, 100))
    p.steps[1].notes.push(note(62, 50))
    const { events } = runSeq(p, LEN * 2)
    const on62 = events.find((e) => e.on && e.note === 62)!
    const off60 = events.find((e) => !e.on && e.note === 60)!
    expect(on62.t).toBe(LEN)
    expect(off60.t).toBe(LEN + 1)
    expect(events.indexOf(on62)).toBeLessThan(events.indexOf(off60))
  })

  it('sub-steps : seules les parties jouées déclenchent une note', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60, 50))
    p.steps[0].subSteps = [true, false, true]
    const { events } = runSeq(p, LEN)
    expect(events.filter((e) => e.on).map((e) => e.t)).toEqual([0, LEN * (2 / 3)])
  })

  it('accords : toutes les notes du pas démarrent ensemble', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60), note(64), note(67))
    const { events } = runSeq(p, 10)
    expect(events.filter((e) => e.on && e.t === 0).map((e) => e.note)).toEqual([60, 64, 67])
  })

  it('probabilité : environ la proportion demandée sur un grand nombre de pas', () => {
    const p = emptyPattern(16)
    for (const s of p.steps) {
      s.notes.push(note(60, 10))
      s.probability = 50
    }
    const { events } = runSeq(p, LEN * 2000)
    const played = events.filter((e) => e.on).length
    expect(played).toBeGreaterThan(900)
    expect(played).toBeLessThan(1100)
  })

  it('shuffle : les pas pairs arrivent en retard, la durée de deux pas est conservée', () => {
    const p = emptyPattern(4)
    for (const s of p.steps) s.notes.push(note(60, 10))
    const { events } = runSeq(p, LEN * 4, (c) => (c.shuffle = 50))
    expect(events.filter((e) => e.on).map((e) => e.t)).toEqual([0, LEN * 1.5, LEN * 2, LEN * 3.5])
  })

  it('boucle sur la longueur du pattern', () => {
    const p = emptyPattern(3)
    p.steps[0].notes.push(note(60, 10))
    p.steps[3].notes.push(note(99, 10)) // hors longueur : jamais joué
    const { events } = runSeq(p, LEN * 7)
    expect(events.filter((e) => e.on).map((e) => [e.t, e.note])).toEqual([
      [0, 60],
      [LEN * 3, 60],
      [LEN * 6, 60],
    ])
  })

  it('stop relâche les notes en cours', () => {
    const p = emptyPattern(4)
    p.steps[0].notes.push(note(60, 100))
    const { events, clock } = runSeq(p, 100)
    clock.stop()
    expect(events.at(-1)).toMatchObject({ note: 60, on: false })
  })
})

describe('Arpégiateur', () => {
  it('ordres des types du manuel', () => {
    const chord = [64, 60, 67]
    expect(arpSequence(chord, ArpType.Up)).toEqual([60, 64, 67])
    expect(arpSequence(chord, ArpType.Down)).toEqual([67, 64, 60])
    expect(arpSequence(chord, ArpType.UpDown)).toEqual([60, 64, 67, 64])
    expect(arpSequence(chord, ArpType.Up2)).toEqual([60, 64, 67, 72, 76, 79])
    expect(arpSequence(chord, ArpType.Down2)).toEqual([79, 76, 72, 67, 64, 60])
  })

  function runArp(setup: (a: Arpeggiator) => void, samples: number) {
    const r = recorder()
    const arp = new Arpeggiator(r.sink, SR)
    arp.on = true
    arp.tempo = 120
    arp.rate = 2 // 1/16
    setup(arp)
    for (let i = 0; i < samples; i++) {
      arp.tick()
      r.advance()
    }
    return { events: r.events, arp }
  }

  it('joue en rythme et legato (attaque suivante avant le relâchement)', () => {
    const { events } = runArp((a) => [60, 64, 67].forEach((n) => a.noteOn(n)), LEN * 3)
    expect(events.filter((e) => e.on).map((e) => [e.t, e.note])).toEqual([
      [0, 60],
      [LEN, 64],
      [LEN * 2, 67],
    ])
    const on64 = events.findIndex((e) => e.on && e.note === 64)
    const off60 = events.findIndex((e) => !e.on && e.note === 60)
    expect(on64).toBeLessThan(off60)
  })

  it('Hold : continue après relâchement, un nouvel accord remplace l’ancien', () => {
    const r = recorder()
    const arp = new Arpeggiator(r.sink, SR)
    arp.on = true
    arp.tempo = 120
    arp.setHold(true)
    arp.noteOn(60)
    arp.noteOn(64)
    arp.noteOff(60)
    arp.noteOff(64)
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        arp.tick()
        r.advance()
      }
    }
    tick(LEN * 2)
    expect(r.events.filter((e) => e.on).map((e) => e.note)).toEqual([60, 64])
    arp.noteOn(70)
    r.events.length = 0
    tick(LEN * 2)
    expect(new Set(r.events.filter((e) => e.on).map((e) => e.note))).toEqual(new Set([70]))
  })

  it('Random ne joue que des notes de l’accord', () => {
    const { events } = runArp((a) => {
      a.type = ArpType.Random
      ;[60, 64, 67].forEach((n) => a.noteOn(n))
    }, LEN * 50)
    for (const e of events.filter((x) => x.on)) expect([60, 64, 67]).toContain(e.note)
  })
})

describe('Portamento Auto avec l’arpégiateur', () => {
  const glides = (trigger: number) => {
    const voices = Array.from({ length: 4 }, (_, i) => new Voice(SR, i + 1))
    const a = new VoiceAllocator(voices)
    a.setMode(VoiceMode.Mono)
    a.portaMode = PortaMode.Auto
    a.envTrigger = trigger
    const p = { ...defaultParams(), portaTime: 0.6 }
    voices[0].updateBlock(p)
    a.noteOn(48, true)
    a.noteOn(60, true)
    a.noteOff(48)
    voices[0].render(p, 0)
    return voices[0].currentPitch < 59
  }

  it('glisse seulement si ENV TRG = Gate (manuel)', () => {
    expect(glides(EnvTrigger.Gate)).toBe(true)
    expect(glides(EnvTrigger.Trig)).toBe(false)
  })
})

describe('Tempo et synchro', () => {
  const def = (id: string) => PARAMS.find((p) => p.id === id)!

  it('INIT : 100 BPM, delay synchronisé à la croche pointée', () => {
    const p = defaultParams()
    expect(mapTempo(p.tempo)).toBe(100)
    expect(p.delaySync).toBe(1)
    expect(formatParam(def('delayNote'), p.delayNote)).toBe('1/8d')
    expect(delaySyncTime(100, p.delayNote)).toBeCloseTo(0.45)
  })

  it('LFO synchronisé : un cycle par valeur de note', () => {
    const quarter = PARAMS.find((p) => p.id === 'lfoNote')!.stepLabels!.indexOf('1/4')
    expect(lfoSyncHz(120, quarter)).toBeCloseTo(2)
  })

  it('noms de notes comme sur la machine', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(72)).toBe('C5')
    expect(noteName(0)).toBe('C-1')
    expect(noteName(127)).toBe('G9')
  })
})
