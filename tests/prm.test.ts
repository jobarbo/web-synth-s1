import { describe, expect, it } from 'vitest'
import { exportPrm, importPrm, type PrmState } from '../src/audio/prm'
import { VoiceMode } from '../src/dsp/allocator'
import { CHOP_NONE, INIT_DRAW_FORM } from '../src/dsp/draw'
import { defaultParams, PARAMS } from '../src/dsp/params'
import { BEND_MOTION, emptyMotionValues, emptyPattern } from '../src/dsp/sequencer'

const initState = (): PrmState => ({
  values: defaultParams(),
  pattern: emptyPattern(),
  drawForm: [...INIT_DRAW_FORM],
  chopMasks: [CHOP_NONE, CHOP_NONE, CHOP_NONE, CHOP_NONE],
})

const line = (text: string, key: string) => text.split('\n').find((l) => l.startsWith(`${key}\t= `))?.split('\t= ')[1]

describe('Export .PRM', () => {
  it('sans fichier de base : patch INIT de la machine, 64 pas et 512 lignes de motion', () => {
    const { text, warnings } = exportPrm(initState())
    expect(warnings).toEqual([])
    expect(line(text, 'VCF_CUTOFF')).toBe('255')
    expect(line(text, 'ASSIGN_MODE')).toBe('2')
    expect(line(text, 'TEMPO')).toBe('10000')
    expect(line(text, 'DELAY_HIGH_CUT')).toBe('14')
    expect(line(text, 'OSC_DRAW_MULT')).toBe('7')
    expect(line(text, 'OSC_CHOP_OVERTONE')).toBe('100')
    // Triangle INIT, tel qu'il apparaît dans les backups
    expect(line(text, 'OSC_DRAW_P1')).toBe('46492')
    expect(line(text, 'OSC_DRAW_P8')).toBe('46542')
    expect(text.match(/^STEP_NOTE /gm)).toHaveLength(64)
    expect(text.match(/^STEP_MOTION /gm)).toHaveLength(512)
    expect(line(text, 'STEP_MOTION 648')).toBe('M1=-1 M2=-1 M3=-1 M4=-1 M5=-1 M6=-1 M7=-1 M8=-1 PB=-32768')
  })

  it('sélecteurs dans l’ordre de la machine', () => {
    const s = initState()
    s.values.voiceMode = VoiceMode.Mono
    s.values.portaMode = 2 // Auto
    const { text } = exportPrm(s)
    expect(line(text, 'ASSIGN_MODE')).toBe('0')
    expect(line(text, 'PORTAMENTO_MODE')).toBe('1')
  })
})

describe('Import .PRM', () => {
  it('relit son propre export : mêmes réglages', () => {
    const s = initState()
    s.values.cutoff = 100 / 255
    s.values.voiceMode = VoiceMode.Chord
    s.values.chord2Shift = 12 - 5
    s.values.drawMult = 0.5
    const r = importPrm(exportPrm(s).text)
    for (const p of PARAMS) {
      if (r.values[p.id] !== undefined) expect(r.values[p.id], p.id).toBeCloseTo(s.values[p.id], 2)
    }
    expect(r.values.voiceMode).toBe(VoiceMode.Chord)
    expect(r.drawForm).toEqual(INIT_DRAW_FORM)
  })

  it('notes, accords, gate, vélocité et probabilité', () => {
    const s = initState()
    s.pattern.length = 32
    s.pattern.transpose = -3
    s.pattern.steps[0].notes = [
      { note: 55, velocity: 127, gate: 80 },
      { note: 62, velocity: 100, gate: 100 },
    ]
    s.pattern.steps[0].probability = 30
    const { text } = exportPrm(s)
    expect(line(text, 'STEP_NOTE 1')).toBe(
      'NOTE1=55 VELO1=127 LENG1=80 NOTE2=62 VELO2=100 LENG2=100 NOTE3=-1 VELO3=0 LENG3=0 NOTE4=-1 VELO4=0 LENG4=0 SUBSTEP=0 PROB=3',
    )
    const r = importPrm(text)
    expect(r.pattern.length).toBe(32)
    expect(r.pattern.transpose).toBe(-3)
    expect(r.pattern.steps[0].notes).toEqual(s.pattern.steps[0].notes)
    expect(r.pattern.steps[0].probability).toBe(30)
  })

  it('motions : CC du paramètre, valeur sur la 1re sous-position du pas', () => {
    const s = initState()
    const values = emptyMotionValues()
    values[2] = 64 / 127
    s.pattern.motions = [{ param: 'cutoff', values }]
    const { text } = exportPrm(s)
    expect(line(text, 'MOTION_CC1')).toBe('74')
    expect(line(text, 'STEP_MOTION 31')).toMatch(/^M1=64 /)
    expect(line(text, 'STEP_MOTION 32')).toMatch(/^M1=-1 /)
    const r = importPrm(text)
    expect(r.pattern.motions).toHaveLength(1)
    expect(r.pattern.motions[0].param).toBe('cutoff')
    expect(r.pattern.motions[0].values[2]).toBeCloseTo(64 / 127, 6)
  })

  it('plusieurs valeurs dans un pas : la première est gardée, avec un avertissement', () => {
    let text = exportPrm(initState()).text
    text = text.replace('MOTION_CC1\t= -1', 'MOTION_CC1\t= 71')
    text = text.replace('STEP_MOTION 11\t= M1=-1', 'STEP_MOTION 11\t= M1=10')
    text = text.replace('STEP_MOTION 12\t= M1=-1', 'STEP_MOTION 12\t= M1=90')
    const r = importPrm(text)
    expect(r.pattern.motions[0].param).toBe('resonance')
    expect(r.pattern.motions[0].values[0]).toBeCloseTo(10 / 127, 6)
    expect(r.warnings.some((w) => w.includes('sous-positions'))).toBe(true)
    // Réexporté sans modification : les 8 sous-positions d'origine sont conservées
    const out = exportPrm({ ...initState(), pattern: r.pattern }, text).text
    expect(out).toBe(text)
  })

  it('pitch bend : importé et exporté avec un avertissement (encodage non vérifié)', () => {
    const s = initState()
    const values = emptyMotionValues()
    values[0] = 0.5
    s.pattern.motions = [{ param: BEND_MOTION, values }]
    const { text, warnings } = exportPrm(s)
    expect(line(text, 'STEP_MOTION 11')).toMatch(/PB=4096$/)
    expect(warnings).toHaveLength(1)
    expect(importPrm(text).pattern.motions[0].values[0]).toBeCloseTo(0.5, 6)
  })

  it('refuse un fichier qui n’est pas un .PRM', () => {
    expect(() => importPrm('bonjour')).toThrow()
  })
})

describe('Aller-retour avec le fichier importé comme base', () => {
  it('clés inconnues, sub-steps et valeurs inchangées sont conservés à l’octet près', () => {
    let base = exportPrm(initState()).text
    base = base.replace('DELAY_SW\t= 1', 'DELAY_SW\t= 0').replace('PRM3\t= 0', 'PRM3\t= 42')
    base = base.replace(
      'STEP_NOTE 5\t= NOTE1=-1 VELO1=0 LENG1=0',
      'STEP_NOTE 5\t= NOTE1=60 VELO1=100 LENG1=80',
    ).replace(/(STEP_NOTE 5\t= .*)SUBSTEP=0/, '$1SUBSTEP=9')
    // Flat encodé 0 (et non 15)
    base = base.replace('REVERB_HIGH_CUT\t= 13', 'REVERB_HIGH_CUT\t= 0')
    const r = importPrm(base)
    expect(r.warnings.some((w) => w.includes('Sub-steps'))).toBe(true)
    const state = { ...initState(), values: { ...defaultParams(), ...r.values }, pattern: r.pattern }
    expect(exportPrm(state, base).text).toBe(base)

    // Pas modifié : réécrit, sub-step perdu (encodage inconnu)
    state.pattern.steps[4].notes[0].gate = 50
    const out = exportPrm(state, base).text
    expect(line(out, 'STEP_NOTE 5')).toMatch(/LENG1=50 .*SUBSTEP=0/)
  })

  it('tie : signalé à l’export', () => {
    const s = initState()
    s.pattern.steps[3].tie = true
    expect(exportPrm(s).warnings[0]).toMatch(/Tie/)
  })
})
