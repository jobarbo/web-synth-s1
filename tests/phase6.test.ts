import { describe, expect, it } from 'vitest'
import { parseMidi } from '../src/audio/midi'
import {
  CHOP_NONE,
  chopMix,
  decodeDrawPoints,
  drawSample,
  drawValue,
  INIT_DRAW_FORM,
} from '../src/dsp/draw'
import { Noise, PinkFilter } from '../src/dsp/osc'
import {
  defaultParams,
  DMOTION_TARGETS,
  formatParam,
  mapFineTune,
  mapKeyFollow,
  mapMultiply,
  mapOvertone,
  PARAMS,
} from '../src/dsp/params'
import { Riser, riserLabel, RiserMode } from '../src/dsp/riser'
import { Voice } from '../src/dsp/voice'

const SR = 48000
const def = (id: string) => PARAMS.find((p) => p.id === id)!
const rms = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)

describe('OSC DRAW', () => {
  it('décode la forme INIT du .PRM : un triangle', () => {
    const raw = [46492, 59342, 6400, 19250, 19300, 6450, 59136, 46542] // OSC_DRAW_P1..P8 de InitPatch.prm
    expect(decodeDrawPoints(raw)).toEqual(INIT_DRAW_FORM)
  })

  it('Step tient la valeur du pas, Slope interpole vers le suivant', () => {
    const form = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : i === 1 ? 100 : 0))
    expect(drawValue(form, false, 0.5 / 16)).toBe(0)
    expect(drawValue(form, true, 0.5 / 16)).toBeCloseTo(0.5)
  })

  it('Multiply 2 monte d’une octave', () => {
    const zeroCrossings = (mult: number) => {
      let n = 0
      let prev = 0
      let phase = 0
      const dt = 100 / SR
      for (let i = 0; i < SR; i++) {
        const y = drawSample(INIT_DRAW_FORM, true, phase, dt, mult)
        if (prev < 0 && y >= 0) n++
        prev = y
        phase = (phase + dt) % 1
      }
      return n
    }
    expect(zeroCrossings(1)).toBeCloseTo(100, -1)
    expect(zeroCrossings(2)).toBeCloseTo(200, -1)
  })

  it('reste borné et sans NaN, même à Multiply 32 en marches', () => {
    let phase = 0
    const dt = 2000 / SR
    for (let i = 0; i < SR / 10; i++) {
      const y = drawSample(INIT_DRAW_FORM, false, phase, dt, 32)
      expect(Number.isFinite(y)).toBe(true)
      expect(Math.abs(y)).toBeLessThan(2)
      phase = (phase + dt) % 1
    }
  })
})

describe('OSC CHOP', () => {
  const input = { square: 0, saw: 1, sub: 0, noise: 0 }
  // Scie coupée sur la première moitié du cycle (pas 1 à 8)
  const masks = [CHOP_NONE, 0xff00, CHOP_NONE, CHOP_NONE]
  const at = (phase: number, overtone: number, comb = 1, freq = 100) =>
    chopMix(input, masks, overtone, comb, phase, 100 / SR, freq)

  it('Overtone 0 : aucun effet ; 100 : pas coupés muets ; 200 : phase inversée', () => {
    expect(at(0.25, 0)).toBe(1)
    expect(at(0.25, 100)).toBe(0)
    expect(at(0.25, 200)).toBe(-1)
    expect(at(0.75, 100)).toBe(1)
  })

  it('Comb 2 répète le motif deux fois par cycle', () => {
    // Points pris à l'intérieur des pas (sur une frontière, la correction anti-aliasing s'applique)
    expect(at(0.2, 100, 2)).toBe(0)
    expect(at(0.4, 100, 2)).toBe(1)
    expect(at(0.6, 100, 2)).toBe(0)
  })

  it('sans effet au-dessus de 1 kHz (manuel)', () => {
    expect(at(0.25, 100, 1, 1500)).toBe(1)
  })

  it('motifs inaltérés : aucun effet, même avec Overtone (valeur INIT 100)', () => {
    expect(chopMix(input, [CHOP_NONE, CHOP_NONE, CHOP_NONE, CHOP_NONE], 100, 1, 0.25, 100 / SR, 100)).toBe(1)
  })
})

describe('Bruit rose', () => {
  it('niveau comparable au blanc, avec moins d’aigus', () => {
    const noise = new Noise(42)
    const pink = new PinkFilter()
    const white: number[] = []
    const pinkOut: number[] = []
    for (let i = 0; i < SR; i++) {
      const w = noise.next()
      white.push(w)
      pinkOut.push(pink.next(w))
    }
    const ratio = rms(pinkOut) / rms(white)
    expect(ratio).toBeGreaterThan(0.4)
    expect(ratio).toBeLessThan(2)
    // Énergie des différences (aigus) relative à l'énergie totale : plus faible pour le rose
    const diffRatio = (a: number[]) => rms(a.slice(1).map((x, i) => x - a[i])) / rms(a)
    expect(diffRatio(pinkOut)).toBeLessThan(diffRatio(white) / 2)
  })
})

describe('Riser', () => {
  const render = (mode: number, pos: number, n = SR) => {
    const r = new Riser(SR)
    const l: number[] = []
    const rr: number[] = []
    for (let i = 0; i < n; i++) {
      r.process(mode, pos, 0.5, 0, 0.7, 120)
      l.push(r.left)
      rr.push(r.right)
    }
    return { l, r: rr }
  }

  it('muet en Off, à r.0 et à d.0', () => {
    expect(rms(render(RiserMode.Off, 0.3).l)).toBe(0)
    expect(rms(render(RiserMode.Quiv, 0).l)).toBe(0)
    expect(rms(render(RiserMode.Quiv, 1).l)).toBe(0)
  })

  it('Sync : silence sur les temps, son sur les contretemps des noires', () => {
    const { l } = render(RiserMode.Sync, 0.4)
    const beat = SR / 2
    expect(rms(l.slice(0, beat / 2 - 10))).toBe(0)
    expect(rms(l.slice(beat / 2 + 10, beat))).toBeGreaterThan(0)
  })

  it('QvPn : gauche et droite diffèrent (balayage)', () => {
    const { l, r } = render(RiserMode.QvPn, 0.4)
    expect(rms(l.map((x, i) => x - r[i]))).toBeGreaterThan(0)
  })

  it('libellés de position comme sur l’afficheur', () => {
    expect(riserLabel(0)).toBe('r.0')
    expect(riserLabel(0.5)).toBe('r.100')
    expect(riserLabel(0.75)).toBe('d.50')
    expect(riserLabel(1)).toBe('d.0')
  })
})

describe('Voix avec Draw, Chop et Fine Tune', () => {
  it('Fine Tune au maximum monte d’une octave', () => {
    const count = (fine: number) => {
      const p = { ...defaultParams(), fineTune: fine, sustain: 1, cutoff: 1, range: 3 }
      const v = new Voice(SR)
      v.updateBlock(p)
      v.noteOn(57, true) // A3 = 220 Hz
      let n = 0
      let prev = 0
      for (let i = 0; i < SR; i++) {
        const y = v.render(p, 0)
        if (i > SR / 10 && prev < 0 && y >= 0) n++
        prev = y
      }
      return n / 0.9
    }
    expect(count(128 / 255)).toBeCloseTo(220, -1)
    expect(count(1)).toBeCloseTo(440, -1)
  })

  it('Draw et Chop actifs : aucun NaN', () => {
    const p = { ...defaultParams(), drawMode: 1, drawMult: 0.6, chopOvertone: 0.8, chopComb: 0.4, sawLevel: 1, subLevel: 1, noiseLevel: 1 }
    const v = new Voice(SR)
    v.wave.chop.set([0x0f0f, 0x00ff, 0xaaaa, 0x5555])
    v.updateBlock(p)
    v.noteOn(48, true)
    for (let i = 0; i < SR / 2; i++) expect(Number.isFinite(v.render(p, 0))).toBe(true)
  })
})

describe('Valeurs INIT et MIDI de la phase 6', () => {
  it('reprennent le .PRM', () => {
    const p = defaultParams()
    expect(mapFineTune(p.fineTune)).toBeCloseTo(0)
    expect(mapMultiply(p.drawMult)).toBe(1)
    expect(mapMultiply(p.chopComb)).toBe(1)
    expect(mapOvertone(p.chopOvertone)).toBe(100)
    expect(formatParam(def('noiseMode'), p.noiseMode)).toBe('Pink')
    expect(DMOTION_TARGETS[p.dmX]).toBe('Pan')
    expect(DMOTION_TARGETS[p.dmY]).toBe('Expr')
  })

  it('CC10 pan, CC11 expression, CC107 Draw', () => {
    expect(parseMidi([0xb0, 10, 0], 0)).toEqual({ type: 'pan', value: -1 })
    expect(parseMidi([0xb0, 11, 127], 0)).toEqual({ type: 'expression', value: 1 })
    expect(parseMidi([0xb0, 107, 2], 0)).toEqual({ type: 'param', id: 'drawMode', value: 2 })
  })
})

describe('Suivi clavier du filtre (Kybd)', () => {
  it('0 = aucun suivi, 255 = suivi exact, faibles valeurs renforcées', () => {
    expect(mapKeyFollow(0)).toBe(0)
    expect(mapKeyFollow(1)).toBe(1)
    expect(mapKeyFollow(64 / 255)).toBeCloseTo(0.5, 1)
    expect(mapKeyFollow(0.1)).toBeGreaterThan(0.3)
  })

  it('affiché sur 0..255 comme sur la machine', () => {
    expect(formatParam(def('keyFollow'), 175 / 255)).toBe('175')
  })
})

describe('Kybd associé à l’Env', () => {
  // Cutoff effectif mesuré par la fréquence d'auto-oscillation du filtre (résonance max, mixer coupé)
  const filterHz = (note: number, keyFollow: number, envMod: number) => {
    const p = { ...defaultParams(), resonance: 1, pulseLevel: 0, sustain: 0, decay: 0, cutoff: 0.5, keyFollow, envMod, vcaMode: 0 }
    const v = new Voice(SR)
    v.updateBlock(p)
    v.noteOn(note, true)
    let n = 0
    let prev = 0
    for (let i = 0; i < SR; i++) {
      const y = v.render(p, 0)
      if (i > SR / 2 && prev < 0 && y >= 0) n++
      prev = y
    }
    return n * 2
  }

  it('Env à 0 : le Kybd n’a pas d’effet', () => {
    expect(filterHz(72, 1, 0)).toBeCloseTo(filterHz(48, 1, 0), -1)
  })

  it('plus l’Env est haut, plus l’écart entre aigus et graves grandit', () => {
    const spread = (envMod: number) => filterHz(72, 1, envMod) / filterHz(48, 1, envMod)
    expect(spread(0.5)).toBeGreaterThan(1.5)
    expect(spread(1)).toBeGreaterThan(spread(0.5) * 1.3)
  })
})
