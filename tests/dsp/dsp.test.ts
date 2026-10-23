import { describe, expect, it } from 'vitest'
import { EnvTrigger, NotePriority, PortaMode, VoiceAllocator, VoiceMode } from '../../src/dsp/allocator'
import { Envelope } from '../../src/dsp/envelope'
import { Lfo, LfoWave } from '../../src/dsp/lfo'
import { LadderFilter } from '../../src/dsp/filter'
import { Oscillator, SubMode } from '../../src/dsp/osc'
import { defaultParams, mapAttackTime, mapDecayTime, mapReleaseTime, PARAMS } from '../../src/dsp/params'
import { Voice } from '../../src/dsp/voice'

const SR = 48000

const risingZeroCrossings = (buf: number[]) => {
  let n = 0
  for (let i = 1; i < buf.length; i++) if (buf[i - 1] < 0 && buf[i] >= 0) n++
  return n
}

const rms = (buf: number[]) => Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length)

function renderOsc(freq: number, key: 'saw' | 'pulse' | 'sub', subMode: number = SubMode.OctDown1) {
  const osc = new Oscillator()
  const out: number[] = []
  for (let i = 0; i < SR; i++) out.push(osc.process(freq, 0.5, subMode, SR)[key])
  return out
}

describe('Oscillator', () => {
  it('produit une dent de scie à la bonne fréquence', () => {
    expect(Math.abs(risingZeroCrossings(renderOsc(440, 'saw')) - 440)).toBeLessThanOrEqual(1)
  })

  it('verrouille le sub une et deux octaves sous l’oscillateur', () => {
    expect(Math.abs(risingZeroCrossings(renderOsc(440, 'sub', SubMode.OctDown1)) - 220)).toBeLessThanOrEqual(1)
    expect(Math.abs(risingZeroCrossings(renderOsc(440, 'sub', SubMode.OctDown2)) - 110)).toBeLessThanOrEqual(1)
    expect(Math.abs(risingZeroCrossings(renderOsc(440, 'sub', SubMode.OctDown2Pulse)) - 110)).toBeLessThanOrEqual(1)
  })

  it('reste borné malgré la correction PolyBLEP', () => {
    for (const key of ['saw', 'pulse', 'sub'] as const) {
      const peak = Math.max(...renderOsc(3000, key).map(Math.abs))
      expect(peak).toBeLessThan(1.3)
    }
  })
})

describe('LadderFilter', () => {
  const sine = (freq: number, n: number) => Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / SR))

  it('atténue fortement les aigus (24 dB/oct)', () => {
    const f = new LadderFilter()
    const input = sine(5000, SR / 2).map((x) => x * 0.1)
    const out = input.map((x) => f.process(x, 200, 0, SR))
    expect(rms(out.slice(SR / 4)) / rms(input)).toBeLessThan(0.001)
  })

  it('laisse passer les graves', () => {
    const f = new LadderFilter()
    const input = sine(50, SR / 2).map((x) => x * 0.1)
    const out = input.map((x) => f.process(x, 2000, 0, SR))
    expect(rms(out.slice(SR / 4)) / rms(input)).toBeGreaterThan(0.9)
  })

  it('auto-oscille de façon stable à résonance maximale', () => {
    const f = new LadderFilter()
    const out: number[] = []
    for (let i = 0; i < SR * 2; i++) out.push(f.process(i === 0 ? 1 : 0, 1000, 4.2, SR))
    const tail = out.slice(-SR / 2)
    expect(tail.every(Number.isFinite)).toBe(true)
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(1.5)
    expect(rms(tail)).toBeGreaterThan(0.05)
  })
})

describe('Envelope', () => {
  it('parcourt attaque, sustain et release jusqu’à zéro', () => {
    const env = new Envelope()
    env.setParams(0.01, 0.1, 0.5, 0.1, SR)
    env.gateOn()
    let peak = 0
    for (let i = 0; i < SR * 0.02; i++) peak = Math.max(peak, env.next())
    expect(peak).toBe(1)
    for (let i = 0; i < SR * 0.5; i++) env.next()
    expect(env.value).toBeCloseTo(0.5, 2)
    env.gateOff()
    for (let i = 0; i < SR * 0.5; i++) env.next()
    expect(env.value).toBe(0)
    expect(env.active).toBe(false)
  })
})

describe('Voice', () => {
  it('ne produit jamais de NaN, même aux réglages extrêmes', () => {
    for (const extreme of [0, 1]) {
      const p = defaultParams()
      for (const def of PARAMS) p[def.id] = def.steps ? (def.steps - 1) * extreme : extreme
      const v = new Voice(SR)
      v.updateBlock(p)
      v.noteOn(extreme ? 108 : 21, true)
      let peak = 0
      for (let i = 0; i < SR; i++) {
        const s = v.render(p, 0)
        expect(Number.isFinite(s)).toBe(true)
        peak = Math.max(peak, Math.abs(s))
      }
      // Borné ; la saturation finale à ±1 est faite au master du processeur
      expect(peak).toBeLessThan(2)
    }
  })
})

describe('Voice : auto-oscillation', () => {
  it('le filtre chante seul, mixer coupé, grâce au bruit de fond', () => {
    const p = { ...defaultParams(), cutoff: 0.5, resonance: 1, sawLevel: 0, pulseLevel: 0, subLevel: 0, sustain: 1 }
    const v = new Voice(SR)
    v.updateBlock(p)
    v.noteOn(60, true)
    const out: number[] = []
    for (let i = 0; i < SR; i++) out.push(v.render(p, 0))
    expect(rms(out.slice(-SR / 4))).toBeGreaterThan(0.02)
  })
})

const pool = () => Array.from({ length: 4 }, (_, i) => new Voice(SR, i + 1))

function allocator(mode: number, envTrigger: number = EnvTrigger.Gate) {
  const voices = pool()
  const a = new VoiceAllocator(voices)
  a.setMode(mode)
  a.envTrigger = envTrigger
  return { a, voices }
}

const gated = (voices: Voice[]) => voices.filter((v) => v.gate).map((v) => v.note).sort((x, y) => x - y)

describe('VoiceAllocator', () => {
  it('Mono : revient à la dernière note tenue', () => {
    const { a, voices } = allocator(VoiceMode.Mono)
    a.noteOn(60)
    a.noteOn(64)
    expect(voices[0].note).toBe(64)
    a.noteOff(64)
    expect(voices[0].note).toBe(60)
    expect(voices[0].gate).toBe(true)
    a.noteOff(60)
    expect(gated(voices)).toEqual([])
  })

  it('Mono en Gate : legato sans redéclencher ; en Trig : chaque note redéclenche', () => {
    const p = defaultParams()
    for (const [trigger, expectRetrig] of [[EnvTrigger.Gate, false], [EnvTrigger.Trig, true]] as const) {
      const { a, voices } = allocator(VoiceMode.Mono, trigger)
      const v = voices[0]
      v.updateBlock({ ...p, attack: 0, decay: 0.2, sustain: 0.2 })
      a.noteOn(60)
      for (let i = 0; i < SR * 0.5; i++) v.render(p, 0)
      a.noteOn(62)
      // Juste après la 2e note : remonte vers 1 si redéclenché, reste sur le sustain sinon
      let peak = 0
      for (let i = 0; i < SR * 0.01; i++) {
        v.render(p, 0)
        peak = Math.max(peak, (v as unknown as { env: Envelope }).env.value)
      }
      expect(peak > 0.9).toBe(expectRetrig)
    }
  })

  it('Mono priorité Low : la note la plus grave gagne', () => {
    const { a, voices } = allocator(VoiceMode.Mono)
    a.priority = NotePriority.Low
    a.noteOn(60)
    a.noteOn(67)
    expect(voices[0].note).toBe(60)
    a.noteOn(55)
    expect(voices[0].note).toBe(55)
    a.noteOff(55)
    expect(voices[0].note).toBe(60)
  })

  it('Poly : 4 voix, la 5e note vole la plus ancienne', () => {
    const { a, voices } = allocator(VoiceMode.Poly)
    for (const n of [60, 64, 67, 71]) a.noteOn(n)
    expect(gated(voices)).toEqual([60, 64, 67, 71])
    a.noteOn(74)
    expect(gated(voices)).toEqual([64, 67, 71, 74])
  })

  it('Poly : réutilise d’abord une voix libérée plutôt que de voler une note tenue', () => {
    const { a, voices } = allocator(VoiceMode.Poly)
    for (const n of [60, 64, 67, 71]) a.noteOn(n)
    a.noteOff(64)
    a.noteOn(74)
    expect(gated(voices)).toEqual([60, 67, 71, 74])
  })

  it('Poly : le vol de voix ne crée pas plus de transitoire qu’une nouvelle note', () => {
    const p = defaultParams()
    const { a, voices } = allocator(VoiceMode.Poly)
    const render = () => voices.reduce((s, v) => s + (v.active ? v.render(p, 0) : 0), 0)
    for (const v of voices) v.updateBlock(p)
    const maxJumpAfter = (note: number) => {
      let prev = 0
      for (let i = 0; i < SR * 0.3; i++) prev = render()
      a.noteOn(note)
      let jump = 0
      for (let i = 0; i < SR * 0.02; i++) {
        const s = render()
        jump = Math.max(jump, Math.abs(s - prev))
        prev = s
      }
      return jump
    }
    for (const n of [48, 52, 55]) a.noteOn(n)
    const freeVoice = maxJumpAfter(59)
    const stolen = maxJumpAfter(62)
    expect(stolen).toBeLessThan(freeVoice * 1.5)
  })

  it('Unison : les 4 voix jouent la même note, désaccordées', () => {
    const { a, voices } = allocator(VoiceMode.Unison)
    a.noteOn(60)
    expect(gated(voices)).toEqual([60, 60, 60, 60])
    expect(new Set(voices.map((v) => v.detune)).size).toBe(4)
  })

  it('Chord : voix 1 + voix d’accord actives avec leur Key Shift', () => {
    const { a, voices } = allocator(VoiceMode.Chord)
    a.chordOn[2] = true
    a.chordShift[2] = -12
    a.noteOn(60)
    expect(gated(voices)).toEqual([48, 60, 64, 67])
    a.chordOn[0] = false
    a.noteOn(62)
    expect(gated(voices)).toEqual([50, 62, 69])
  })

  it('changer de mode coupe les notes en cours', () => {
    const { a, voices } = allocator(VoiceMode.Poly)
    a.noteOn(60)
    a.setMode(VoiceMode.Mono)
    expect(gated(voices)).toEqual([])
    expect(voices.every((v) => v.detune === 0)).toBe(true)
  })
})

describe('Portamento', () => {
  const run = (portaMode: number, legato: boolean) => {
    const p = { ...defaultParams(), portaTime: 0.6 }
    const { a, voices } = allocator(VoiceMode.Mono)
    a.portaMode = portaMode
    voices[0].updateBlock(p)
    a.noteOn(48)
    if (!legato) a.noteOff(48)
    a.noteOn(60)
    voices[0].render(p, 0)
    return voices[0].currentPitch
  }

  it('Off : saute directement à la note', () => {
    expect(run(PortaMode.Off, true)).toBe(60)
  })

  it('On : glisse toujours', () => {
    expect(run(PortaMode.On, false)).toBeLessThan(50)
    expect(run(PortaMode.On, true)).toBeLessThan(50)
  })

  it('Auto : glisse seulement en legato', () => {
    expect(run(PortaMode.Auto, false)).toBe(60)
    expect(run(PortaMode.Auto, true)).toBeLessThan(50)
  })

  it('Poly + On : glisse depuis la dernière note jouée, legato ou non', () => {
    const p = { ...defaultParams(), portaTime: 0.6 }
    for (const legato of [true, false]) {
      const { a, voices } = allocator(VoiceMode.Poly)
      a.portaMode = PortaMode.On
      for (const v of voices) v.updateBlock(p)
      a.noteOn(48)
      if (!legato) a.noteOff(48)
      a.noteOn(60)
      const v = voices.find((x) => x.gate && x.note === 60)!
      v.render(p, 0)
      expect(v.currentPitch).toBeLessThan(49)
    }
  })

  it('Poly + On : la toute première note ne glisse pas', () => {
    const p = { ...defaultParams(), portaTime: 0.6 }
    const { a, voices } = allocator(VoiceMode.Poly)
    a.portaMode = PortaMode.On
    for (const v of voices) v.updateBlock(p)
    a.noteOn(60)
    const v = voices.find((x) => x.gate)!
    v.render(p, 0)
    expect(v.currentPitch).toBe(60)
  })

  it('Poly + Auto : glisse en legato seulement', () => {
    const p = { ...defaultParams(), portaTime: 0.6 }
    const { a, voices } = allocator(VoiceMode.Poly)
    a.portaMode = PortaMode.Auto
    for (const v of voices) v.updateBlock(p)
    a.noteOn(48)
    a.noteOff(48)
    a.noteOn(60)
    const detached = voices.find((x) => x.gate && x.note === 60)!
    detached.render(p, 0)
    expect(detached.currentPitch).toBe(60)
    a.noteOn(72)
    const legato = voices.find((x) => x.gate && x.note === 72)!
    legato.render(p, 0)
    expect(legato.currentPitch).toBeLessThan(61)
  })

  it('atteint la note cible', () => {
    const p = { ...defaultParams(), portaTime: 0.4 }
    const { a, voices } = allocator(VoiceMode.Mono)
    a.portaMode = PortaMode.On
    voices[0].updateBlock(p)
    a.noteOn(48)
    a.noteOn(60)
    for (let i = 0; i < SR; i++) voices[0].render(p, 0)
    expect(voices[0].currentPitch).toBeCloseTo(60, 2)
  })
})

describe('Lfo', () => {
  it('produit le bon nombre de cycles et reste dans -1..1', () => {
    for (const wave of Object.values(LfoWave)) {
      const lfo = new Lfo()
      let wraps = 0
      for (let i = 0; i < SR; i++) {
        const y = lfo.process(5, wave, SR)
        expect(Math.abs(y)).toBeLessThanOrEqual(1)
        if (lfo.wrapped) wraps++
      }
      expect(wraps).toBe(5)
    }
  })

  it('Key Trigger remet la phase à zéro', () => {
    const lfo = new Lfo()
    for (let i = 0; i < 1000; i++) lfo.process(3, LfoWave.Triangle, SR)
    lfo.reset()
    expect(lfo.phase).toBe(0)
  })
})

describe('Valeurs INIT de la machine', () => {
  const p = defaultParams()

  it('reprennent le patch INIT : carré seul, filtre ouvert, Poly, 16\'', () => {
    expect(p.pulseLevel).toBe(1)
    expect(p.sawLevel + p.subLevel + p.noiseLevel).toBe(0)
    expect(p.cutoff).toBe(1)
    expect(p.resonance + p.envMod + p.keyFollow).toBe(0)
    expect(p.voiceMode).toBe(VoiceMode.Poly)
    expect(PARAMS.find((d) => d.id === 'range')!.stepLabels![p.range]).toBe("16'")
    expect(PARAMS.find((d) => d.id === 'subMode')!.stepLabels![p.subMode]).toBe('-1 oct')
    expect(Math.round(p.volume * 127)).toBe(70)
    expect(Math.round(p.decay * 255)).toBe(84)
  })
})

describe('Temps d’enveloppe mesurés sur machine', () => {
  it('collent aux points de mesure', () => {
    expect(mapDecayTime(63 / 127)).toBeCloseTo(1.94, 2)
    expect(mapDecayTime(1)).toBeCloseTo(12.9, 2)
    expect(mapAttackTime(1)).toBeCloseTo(3.571, 2)
    expect(mapReleaseTime(63 / 127)).toBeCloseTo(2.375, 0)
  })

  it('le decay atteint -60 dB du sustain au temps demandé', () => {
    const env = new Envelope()
    const decay = 0.2
    env.setParams(0, decay, 0, 0.1, SR)
    env.gateOn()
    for (let i = 0; i < 10; i++) env.next()
    for (let i = 0; i < SR * decay; i++) env.next()
    expect(env.value).toBeCloseTo(0.001, 3)
  })
})
