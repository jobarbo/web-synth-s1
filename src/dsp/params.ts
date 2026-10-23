/**
 * Paramètres du synthé, exprimés comme sur la machine : positions de slider normalisées 0..1
 * (ou index pour les sélecteurs). Les fonctions `map*` convertissent en unités DSP.
 * Noms et options alignés sur le manuel S-1 v1.02 ; les plages en Hz / ms ne sont pas documentées
 * par Roland et sont donc nos propres calibrations, sauf l'enveloppe (mesures sur machine, voir mapAttackTime).
 *
 * Valeurs par défaut = patch INIT de la machine (MENU > init). Roland ne publie pas ces valeurs :
 * elles proviennent du fichier InitPatch.prm (backup .PRM d'un pattern initialisé sur un S-1),
 * embarqué dans l'éditeur open source S1Utility (github.com/denzlobin/S1Utility).
 * Les valeurs .PRM vont de 0 à 255 ; `prm()` les ramène en 0..1.
 */

import { ARP_RATES, ARP_TYPE_LABELS } from './arpeggiator'
import { riserLabel } from './riser'
import { STEP_SCALES } from './sequencer'

export type Section =
  | 'voice'
  | 'lfo'
  | 'osc'
  | 'mixer'
  | 'filter'
  | 'env'
  | 'amp'
  | 'ctrl'
  | 'chord'
  | 'seq'
  | 'arp'
  | 'draw'
  | 'chop'
  | 'riser'
  | 'dmotion'
  | 'chorus'
  | 'delay'
  | 'reverb'

/** Sections traitées par la chaîne d'effets (thread principal), pas par le worklet. */
export const FX_SECTIONS: ReadonlySet<Section> = new Set(['chorus', 'delay', 'reverb'])

export interface ParamDef {
  id: ParamId
  label: string
  section: Section
  default: number
  /** Nombre de positions pour un sélecteur. Absent = slider continu 0..1. */
  steps?: number
  stepLabels?: string[]
  /** Par défaut : sélecteur à LED si `stepLabels`, sinon slider. `slider` force un slider à crans (longues listes). */
  control?: 'slider'
}

export type ParamId =
  | 'voiceMode'
  | 'notePriority'
  | 'portaMode'
  | 'portaTime'
  | 'lfoWave'
  | 'lfoRate'
  | 'lfoMode'
  | 'lfoKeyTrig'
  | 'range'
  | 'oscLfo'
  | 'pwmSource'
  | 'pulseWidth'
  | 'subMode'
  | 'sawLevel'
  | 'pulseLevel'
  | 'subLevel'
  | 'noiseLevel'
  | 'cutoff'
  | 'resonance'
  | 'filterLfo'
  | 'envMod'
  | 'keyFollow'
  | 'attack'
  | 'decay'
  | 'sustain'
  | 'release'
  | 'envTrigger'
  | 'vcaMode'
  | 'volume'
  | 'chord2On'
  | 'chord2Shift'
  | 'chord3On'
  | 'chord3Shift'
  | 'chord4On'
  | 'chord4Shift'
  | 'oscBendSens'
  | 'filterBendSens'
  | 'modDepth'
  | 'chorusType'
  | 'delayLevel'
  | 'delayTime'
  | 'delayFeedback'
  | 'delayLowCut'
  | 'delayHighCut'
  | 'delayLevelMode'
  | 'reverbType'
  | 'reverbLevel'
  | 'reverbTime'
  | 'reverbPreDelay'
  | 'reverbLowCut'
  | 'reverbHighCut'
  | 'reverbDensity'
  | 'tempo'
  | 'stepScale'
  | 'shuffle'
  | 'arpOn'
  | 'arpType'
  | 'arpRate'
  | 'delaySync'
  | 'delayNote'
  | 'lfoSync'
  | 'lfoNote'
  | 'metronome'
  | 'metronomeLevel'
  | 'countIn'
  | 'fineTune'
  | 'noiseMode'
  | 'drawMode'
  | 'drawMult'
  | 'chopOvertone'
  | 'chopComb'
  | 'riserMode'
  | 'riserPos'
  | 'riserReso'
  | 'riserShape'
  | 'riserLevel'
  | 'dmX'
  | 'dmY'
  | 'dmSensX'
  | 'dmSensY'

const OFF_ON = ['Off', 'On']

/** Cibles de D-MOTION (manuel, Configuring D-MOTION), ordre du .PRM. */
export const DMOTION_TARGETS = ['Off', 'Mod', 'Freq', 'Reso', 'Bend', 'Pan', 'Expr', 'Dly lvl', 'Rev lvl']
export const DMotionTarget = { Off: 0, Mod: 1, Freq: 2, Reso: 3, Bend: 4, Pan: 5, Expression: 6, DelayLevel: 7, ReverbLevel: 8 } as const
const prm = (raw: number) => raw / 255
/** Key Shift des voix d'accord : -12..+12 demi-tons, index 12 = 0. */
const SHIFT_STEPS = 25

/** Listes Low Cut / High Cut du manuel (section EFX), communes au delay et à la reverb. */
export const LOW_CUT_LABELS = ['Flat', '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160', '200', '250', '315', '400', '500', '630', '800']
export const HIGH_CUT_LABELS = ['630', '800', '1k', '1.25k', '1.6k', '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', 'Flat']
// Dans le .PRM, la liste High Cut commence par un « Flat » supplémentaire : index .PRM = index ci-dessus + 1
export const highCutFromPrm = (raw: number) => (raw === 0 ? HIGH_CUT_LABELS.length - 1 : raw - 1)

/** Valeurs de note du Delay Sync (manuel EFX), ordre du .PRM : du plus court au plus long. Durées en noires. */
export const DELAY_NOTES: { label: string; beats: number }[] = [
  { label: '1/128', beats: 1 / 32 },
  { label: '1/64t', beats: 1 / 24 },
  { label: '1/128d', beats: 3 / 64 },
  { label: '1/64', beats: 1 / 16 },
  { label: '1/32t', beats: 1 / 12 },
  { label: '1/64d', beats: 3 / 32 },
  { label: '1/32', beats: 1 / 8 },
  { label: '1/16t', beats: 1 / 6 },
  { label: '1/32d', beats: 3 / 16 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/8t', beats: 1 / 3 },
  { label: '1/16d', beats: 3 / 8 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/4t', beats: 2 / 3 },
  { label: '1/8d', beats: 3 / 4 },
  { label: '1/4', beats: 1 },
]

/*
 * Valeurs de note du LFO Sync. Le manuel indique « de 8_1 à 1/128, avec pointées et triolets »
 * sans donner la liste exacte : liste reconstituée, du plus long au plus court. Durée d'un cycle en noires.
 */
export const LFO_NOTES: { label: string; beats: number }[] = [
  { label: '8/1', beats: 32 },
  { label: '4/1', beats: 16 },
  { label: '2/1', beats: 8 },
  { label: '1/1', beats: 4 },
  { label: '1/2d', beats: 3 },
  { label: '1/2', beats: 2 },
  { label: '1/4d', beats: 1.5 },
  { label: '1/2t', beats: 4 / 3 },
  { label: '1/4', beats: 1 },
  { label: '1/8d', beats: 3 / 4 },
  { label: '1/4t', beats: 2 / 3 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/16d', beats: 3 / 8 },
  { label: '1/8t', beats: 1 / 3 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/16t', beats: 1 / 6 },
  { label: '1/32', beats: 1 / 8 },
  { label: '1/64', beats: 1 / 16 },
  { label: '1/128', beats: 1 / 32 },
]

/** Tempo : 40 à 300 BPM au 1/10 (plage non publiée par Roland, à confirmer). */
export const TEMPO_MIN = 40
export const TEMPO_MAX = 300
export const mapTempo = (v: number) => Math.round((TEMPO_MIN + (TEMPO_MAX - TEMPO_MIN) * v) * 10) / 10
export const tempoToUnit = (bpm: number) => (bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)

/** Fine Tune : ±12 demi-tons (manuel : ±1 octave), centre à 128 sur 0..255. */
export const mapFineTune = (v: number) => ((v * 255 - 128) / 127) * 12

/** Multiply (Draw) et Comb (Chop) : 1.0 à 32.0, une octave par cinquième de course (courbe maison). */
export const mapMultiply = (v: number) => Math.pow(2, 5 * v)

/** Overtone : 0..200 (100 = pas coupés muets). */
export const mapOvertone = (v: number) => Math.round(v * 200)

/** Niveau du métronome 0..100 (Ntr.L) → gain du clic. */
export const mapMetronomeLevel = (v: number) => 0.4 * v * v

/** Shuffle 0..50 (plage du .PRM). */
export const mapShuffle = (v: number) => Math.round(v * 50)

/** Fréquence du LFO synchronisé : un cycle par valeur de note. */
export const lfoSyncHz = (tempo: number, noteIndex: number) =>
  tempo / 60 / (LFO_NOTES[Math.round(noteIndex)] ?? LFO_NOTES[8]).beats

/** Temps de delay synchronisé, en secondes. */
export const delaySyncTime = (tempo: number, noteIndex: number) =>
  (60 / tempo) * (DELAY_NOTES[Math.round(noteIndex)] ?? DELAY_NOTES[14]).beats

export const PARAMS: ParamDef[] = [
  // Valeurs INIT entre parenthèses : clé .PRM = valeur brute
  { id: 'voiceMode', label: 'Mode', section: 'voice', default: 0, steps: 4, stepLabels: ['Poly', 'Mono', 'Unison', 'Chord'] }, // ASSIGN_MODE = Poly
  { id: 'notePriority', label: 'Priority', section: 'voice', default: 0, steps: 2, stepLabels: ['Last', 'Low'] }, // absent du .PRM
  { id: 'portaMode', label: 'Porta', section: 'voice', default: 0, steps: 3, stepLabels: ['Off', 'On', 'Auto'] }, // PORTAMENTO_MODE = Off
  { id: 'portaTime', label: 'Time', section: 'voice', default: prm(30) }, // PORTAMENTO_TIME = 30

  { id: 'lfoWave', label: 'Wave', section: 'lfo', default: 2, steps: 6, stepLabels: ['Saw', 'Inv saw', 'Triangle', 'Square', 'Random', 'Noise'] }, // LFO_WAVE_FORM = Triangle
  { id: 'lfoRate', label: 'Rate', section: 'lfo', default: prm(120) }, // LFO_RATE = 120
  { id: 'lfoMode', label: 'Mode', section: 'lfo', default: 0, steps: 2, stepLabels: ['Normal', 'Fast'] }, // LFO_MODE = Normal
  { id: 'lfoKeyTrig', label: 'Key trig', section: 'lfo', default: 0, steps: 2, stepLabels: OFF_ON }, // LFO_KEY_TRIG = Off
  { id: 'lfoSync', label: 'Sync', section: 'lfo', default: 0, steps: 2, stepLabels: OFF_ON }, // LFO_SYNC = Off
  // Valeur de note par défaut non connue (le .PRM ne stocke que LFO_RATE) : 1/4 retenu
  { id: 'lfoNote', label: 'Note', section: 'lfo', default: 8, steps: LFO_NOTES.length, stepLabels: LFO_NOTES.map((n) => n.label), control: 'slider' },

  { id: 'range', label: 'Range', section: 'osc', default: 2, steps: 6, stepLabels: ["64'", "32'", "16'", "8'", "4'", "2'"] }, // VCO_RANGE = 16'
  { id: 'oscLfo', label: 'LFO', section: 'osc', default: 0 }, // VCO_MOD_DEPTH = 0
  { id: 'pwmSource', label: 'PWM src', section: 'osc', default: 2, steps: 3, stepLabels: ['Env', 'Man', 'LFO'] }, // VCO_PWM_SOURCE = LFO
  { id: 'pulseWidth', label: 'PWM', section: 'osc', default: 0 }, // VCO_PULSE_WIDTH = 0
  // Fine Tune (SHIFT + RANGE) : ±1 octave ; FINE_TUNE = 128 = centre
  { id: 'fineTune', label: 'Fine', section: 'osc', default: 128 / 255 },
  // Ordre de la machine (manuel : -2o.A, -2oc, -1oc)
  { id: 'subMode', label: 'Sub oct', section: 'osc', default: 2, steps: 3, stepLabels: ['-2 oct A', '-2 oct', '-1 oct'] }, // VCO_SUB_TYPE = -1 oct

  { id: 'pulseLevel', label: 'Square', section: 'mixer', default: prm(255) }, // VCO_PWM_LEVEL = 255
  { id: 'sawLevel', label: 'Saw', section: 'mixer', default: 0 }, // VCO_SAW_LEVEL = 0
  { id: 'subLevel', label: 'Sub', section: 'mixer', default: 0 }, // VCO_SUB_LEVEL = 0
  { id: 'noiseLevel', label: 'Noise', section: 'mixer', default: 0 }, // VCO_NOISE_LEVEL = 0
  { id: 'noiseMode', label: 'Bruit', section: 'mixer', default: 0, steps: 2, stepLabels: ['Pink', 'White'] }, // NOISE_MODE = Pink

  { id: 'cutoff', label: 'Freq', section: 'filter', default: prm(255) }, // VCF_CUTOFF = 255
  { id: 'resonance', label: 'Reso', section: 'filter', default: 0 }, // VCF_RESONANCE = 0
  { id: 'filterLfo', label: 'LFO', section: 'filter', default: 0 }, // VCF_MOD_DEPTH = 0
  { id: 'envMod', label: 'Env', section: 'filter', default: 0 }, // VCF_ENV_DEPTH = 0
  { id: 'keyFollow', label: 'Kybd', section: 'filter', default: 0 }, // VCF_KEY_FOLLOW = 0

  { id: 'attack', label: 'A', section: 'env', default: 0 }, // ENV_ATTACK = 0
  { id: 'decay', label: 'D', section: 'env', default: prm(84) }, // ENV_DECAY = 84
  { id: 'sustain', label: 'S', section: 'env', default: prm(51) }, // ENV_SUSTAIN = 51
  { id: 'release', label: 'R', section: 'env', default: prm(42) }, // ENV_RELEASE = 42
  { id: 'envTrigger', label: 'Trig', section: 'env', default: 2, steps: 3, stepLabels: ['LFO', 'Gate', 'Trig'] }, // ENV_TRG_MODE = Gate+Trig

  { id: 'vcaMode', label: 'Amp', section: 'amp', default: 1, steps: 2, stepLabels: ['Gate', 'Env'] }, // VCA_ENV_MODE = Env
  { id: 'volume', label: 'Volume', section: 'amp', default: 70 / 127 }, // LEVEL = 70 (sur 127)

  // Key Shift stocké en demi-tons signés dans le .PRM ; index 12 = 0
  { id: 'chord2On', label: 'Voice 2', section: 'chord', default: 1, steps: 2, stepLabels: OFF_ON }, // CHORD_VOICE2_SW = On
  { id: 'chord2Shift', label: 'Shift 2', section: 'chord', default: 12 + 12, steps: SHIFT_STEPS }, // KEY_SHIFT = +12
  { id: 'chord3On', label: 'Voice 3', section: 'chord', default: 1, steps: 2, stepLabels: OFF_ON }, // CHORD_VOICE3_SW = On
  { id: 'chord3Shift', label: 'Shift 3', section: 'chord', default: 12 + 7, steps: SHIFT_STEPS }, // KEY_SHIFT = +7
  { id: 'chord4On', label: 'Voice 4', section: 'chord', default: 1, steps: 2, stepLabels: OFF_ON }, // CHORD_VOICE4_SW = On
  { id: 'chord4Shift', label: 'Shift 4', section: 'chord', default: 12 + 5, steps: SHIFT_STEPS }, // KEY_SHIFT = +5

  // Pitch bend et molette de modulation (menu : bnd.o 0..240, bnd.F 0..255, Nod.d 0..255)
  { id: 'oscBendSens', label: 'Bend osc', section: 'ctrl', default: 20 / 240 }, // VCO_BEND_SENS = 20
  { id: 'filterBendSens', label: 'Bend flt', section: 'ctrl', default: 0 }, // VCF_BEND_SENS = 0
  { id: 'modDepth', label: 'Mod depth', section: 'ctrl', default: prm(30) }, // LFO_MOD_DEPTH = 30

  { id: 'chorusType', label: 'Chorus', section: 'chorus', default: 0, steps: 5, stepLabels: ['Off', '1', '2', '3', '4'] }, // CHORUS = Off

  { id: 'delayLevel', label: 'Level', section: 'delay', default: 0 }, // DELAY_LEVEL = 0
  { id: 'delaySync', label: 'Sync', section: 'delay', default: 1, steps: 2, stepLabels: OFF_ON }, // TEMPO_SYNC = On
  { id: 'delayTime', label: 'Time', section: 'delay', default: prm(174) }, // DELAY_TIME = 174 (~500 ms)
  { id: 'delayNote', label: 'Note', section: 'delay', default: 14, steps: DELAY_NOTES.length, stepLabels: DELAY_NOTES.map((n) => n.label), control: 'slider' }, // DELAY_TEMPO = 1/8d
  { id: 'delayFeedback', label: 'Fdbk', section: 'delay', default: prm(136) }, // DELAY_FEEDBACK = 136
  { id: 'delayLowCut', label: 'Lo cut', section: 'delay', default: 12, steps: LOW_CUT_LABELS.length, stepLabels: LOW_CUT_LABELS, control: 'slider' }, // DELAY_LOW_CUT = 250 Hz
  { id: 'delayHighCut', label: 'Hi cut', section: 'delay', default: highCutFromPrm(14), steps: HIGH_CUT_LABELS.length, stepLabels: HIGH_CUT_LABELS, control: 'slider' }, // DELAY_HIGH_CUT = 12.5k
  // Delay Level Mode (menu système) : le Level agit avant (Pre) ou après (Post) le delay. Valeur par défaut non documentée.
  { id: 'delayLevelMode', label: 'Lvl mode', section: 'delay', default: 0, steps: 2, stepLabels: ['Pre', 'Post'] },

  { id: 'reverbType', label: 'Type', section: 'reverb', default: 5, steps: 7, stepLabels: ['Ambience', 'Room', 'Hall 1', 'Hall 2', 'Plate', 'Spring', 'Modulate'] }, // REVERB_TYPE = Spring
  { id: 'reverbLevel', label: 'Level', section: 'reverb', default: 0 }, // REVERB_LEVEL = 0
  { id: 'reverbTime', label: 'Time', section: 'reverb', default: prm(200) }, // REVERB_TIME = 200
  { id: 'reverbPreDelay', label: 'Pre-dly', section: 'reverb', default: 20 / 100 }, // REVERB_PRE_DELAY = 20 ms
  { id: 'reverbLowCut', label: 'Lo cut', section: 'reverb', default: 12, steps: LOW_CUT_LABELS.length, stepLabels: LOW_CUT_LABELS, control: 'slider' }, // REVERB_LOW_CUT = 250 Hz
  { id: 'reverbHighCut', label: 'Hi cut', section: 'reverb', default: highCutFromPrm(13), steps: HIGH_CUT_LABELS.length, stepLabels: HIGH_CUT_LABELS, control: 'slider' }, // REVERB_HIGH_CUT = 10k
  { id: 'reverbDensity', label: 'Density', section: 'reverb', default: 10, steps: 11 }, // REVERB_DENSITY = 10

  // OSC DRAW : remplace le carré ; OSC_DRAW_SW = Off, OSC_DRAW_MULT = 7 (= 1.0)
  { id: 'drawMode', label: 'Draw', section: 'draw', default: 0, steps: 3, stepLabels: ['Off', 'Step', 'Slope'] },
  { id: 'drawMult', label: 'Multiply', section: 'draw', default: 0 },
  // OSC CHOP : OSC_CHOP_OVERTONE = 100, OSC_CHOP_COMB = 7 (= 1.0)
  { id: 'chopOvertone', label: 'Overtone', section: 'chop', default: 0.5 },
  { id: 'chopComb', label: 'Comb', section: 'chop', default: 0 },

  // Riser : RISER_MODE = Off, RISER_RESO = 50, RISER_SHAPE = 0, RISER_LEVEL = 70 ; la position n'est pas sauvegardée (manuel)
  { id: 'riserMode', label: 'Mode', section: 'riser', default: 0, steps: 4, stepLabels: ['Off', 'Sync', 'Quiv', 'QvPn'] },
  { id: 'riserPos', label: 'Position', section: 'riser', default: 0 },
  { id: 'riserReso', label: 'Reso', section: 'riser', default: 0.5 },
  { id: 'riserShape', label: 'Shape', section: 'riser', default: 0 },
  { id: 'riserLevel', label: 'Level', section: 'riser', default: 0.7 },

  // D-MOTION : DM_ASSIGN_X = 5 (Pan), DM_ASSIGN_Y = 6 (Expression), DM_SENS_X/Y = 5
  { id: 'dmX', label: 'Axe X', section: 'dmotion', default: 5, steps: DMOTION_TARGETS.length, stepLabels: DMOTION_TARGETS, control: 'slider' },
  { id: 'dmY', label: 'Axe Y', section: 'dmotion', default: 6, steps: DMOTION_TARGETS.length, stepLabels: DMOTION_TARGETS, control: 'slider' },
  { id: 'dmSensX', label: 'Sens X', section: 'dmotion', default: 5, steps: 11 },
  { id: 'dmSensY', label: 'Sens Y', section: 'dmotion', default: 5, steps: 11 },

  // Séquenceur (affichés dans la zone séquenceur, pas dans le panneau)
  { id: 'tempo', label: 'Tempo', section: 'seq', default: tempoToUnit(100) }, // TEMPO = 10000 (100,0 BPM)
  { id: 'stepScale', label: 'Pas', section: 'seq', default: 1, steps: STEP_SCALES.length, stepLabels: STEP_SCALES.map((x) => x.label) }, // P.SCL ; SCALE = 1 supposé 1/16
  { id: 'shuffle', label: 'Shuffle', section: 'seq', default: 0 }, // SHUFFLE = 0
  // Métronome et décompte : réglages système (menu), valeurs par défaut non documentées
  { id: 'metronome', label: 'Métronome', section: 'seq', default: 1, steps: 3, stepLabels: ['Off', 'Rec', 'Rec&Play'] },
  { id: 'metronomeLevel', label: 'Niveau', section: 'seq', default: 0.5 },
  { id: 'countIn', label: 'Décompte', section: 'seq', default: 0, steps: 4, stepLabels: ['Off', '2', '3', '4'] },

  // Arpégiateur : l'activation est un réglage global de la machine, absent du .PRM
  { id: 'arpOn', label: 'Arp', section: 'arp', default: 0, steps: 2, stepLabels: OFF_ON },
  { id: 'arpType', label: 'Type', section: 'arp', default: 0, steps: ARP_TYPE_LABELS.length, stepLabels: ARP_TYPE_LABELS }, // ARP_TYPE = Up
  { id: 'arpRate', label: 'Rate', section: 'arp', default: 2, steps: ARP_RATES.length, stepLabels: ARP_RATES.map((x) => x.label) }, // ARP_RATE = 1/16
]

/** Paramètres lus par le worklet (tout sauf la chaîne d'effets). */
export const SYNTH_PARAMS = PARAMS.filter((p) => !FX_SECTIONS.has(p.section))

export const defaultParams = (): Record<ParamId, number> =>
  Object.fromEntries(PARAMS.map((p) => [p.id, p.default])) as Record<ParamId, number>

/** 8' = hauteur réelle. Retourne un décalage en octaves. */
export const mapRange = (index: number) => Math.round(index) - 3

/** Rapport cyclique pour une profondeur de PWM 0..1 : 50 % (carré) à 5 % (pulse fin). */
export const mapPulseWidth = (v: number) => 0.5 - 0.45 * v

/** Cutoff exponentiel : ~20 Hz à ~20 kHz sur 10 octaves. */
export const mapCutoff = (v: number) => 20 * Math.pow(2, v * 10)

/** Résonance : auto-oscillation dans le dernier ~5 % de la course. */
export const mapResonance = (v: number) => 4.2 * v

/**
 * Suivi clavier du filtre (FILTER KYBD, 0..255) : fraction de la hauteur suivie par le cutoff.
 * Manuel : 255 = suivi parfait. À l'écoute de la machine, les faibles valeurs suivent nettement plus qu'une
 * courbe linéaire : courbe en racine carrée (ex. 64/255 ≈ 50 % de suivi). Calibration à l'oreille.
 */
export const mapKeyFollow = (v: number) => Math.sqrt(Math.max(0, v))

/** Profondeur de l'enveloppe sur le cutoff, en octaves. */
export const mapEnvMod = (v: number) => 8 * v

/*
 * Temps d'enveloppe calés sur des mesures faites sur un S-1 (protocole -60 dB, publiées dans S1Utility).
 * v = position du slider 0..1, équivalente à CC / 127.
 */

/** Attack : ~1 ms à 3,57 s, loi de puissance 2,55. */
export const mapAttackTime = (v: number) => 0.001 + Math.pow(v, 2.55) * 3.57

/** Release : ~1 ms à 16,25 s, loi de puissance 2,74. */
export const mapReleaseTime = (v: number) => 0.001 + Math.pow(v, 2.74) * 16.25

// Decay : aucune loi de puissance unique ne colle aux mesures, d'où une table (CC, secondes)
const DECAY_TABLE: [number, number][] = [
  [0, 0.001],
  [63, 1.94],
  [95, 4.05],
  [110, 6.1],
  [127, 12.9],
]

/** Decay : interpolation linéaire de la table mesurée, ~1 ms à 12,9 s. */
export function mapDecayTime(v: number): number {
  const cc = v * 127
  for (let i = 1; i < DECAY_TABLE.length; i++) {
    const [c1, t1] = DECAY_TABLE[i]
    if (cc <= c1) {
      const [c0, t0] = DECAY_TABLE[i - 1]
      return t0 + ((cc - c0) / (c1 - c0)) * (t1 - t0)
    }
  }
  return DECAY_TABLE[DECAY_TABLE.length - 1][1]
}

/** Volume avec une courbe proche de la perception. */
export const mapVolume = (v: number) => v * v

/** LFO : ~0,05 Hz à ~36 Hz ; le mode Fast multiplie par 16 (jusqu'au domaine audio). */
export const mapLfoRate = (v: number, fast: boolean) => 0.05 * Math.pow(2, v * 9.5) * (fast ? 16 : 1)

/** Profondeur LFO → hauteur, en demi-tons. Courbe quadratique pour un vibrato fin en début de course. */
export const mapLfoPitch = (v: number) => 12 * v * v

/** Profondeur LFO → cutoff, en octaves. */
export const mapLfoFilter = (v: number) => 4 * v

/**
 * Temps de portamento : 0 à 4,5 s. Le manuel ne donne que 0..255 sans unité ; le maximum de ~4-5 s vient
 * de l'écoute de la machine. Loi de puissance 2,5, comme les temps d'enveloppe mesurés (précision en début de course).
 */
export const mapPortaTime = (v: number) => (v <= 0 ? 0 : 4.5 * Math.pow(v, 2.5))

/** Bend osc : 240 = ±2 octaves (manuel : 120 = ±1 oct). Retourne des demi-tons pour un bend à fond. */
export const mapOscBend = (v: number) => 24 * v

/** Bend filtre : profondeur en octaves à fond. Le manuel ne donne que 0..255 : ±4 octaves, calibration maison. */
export const mapFilterBend = (v: number) => 4 * v

/*
 * Delay Time : correspondance valeur brute (0..255) → ms affichés par la machine, mesurée sur S-1
 * (points d'ancrage publiés dans S1Utility). Plage du manuel : 1 à 740 ms.
 */
const DELAY_ANCHORS: [number, number][] = [
  [0, 1],
  [11, 14],
  [26, 44],
  [55, 103],
  [106, 273],
  [179, 517],
  [245, 737],
  [255, 740],
]

const interpolate = (table: [number, number][], x: number) => {
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]
    if (x <= x1) {
      const [x0, y0] = table[i - 1]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return table[table.length - 1][1]
}

/** Delay Time en secondes. */
export const mapDelayTime = (v: number) => interpolate(DELAY_ANCHORS, v * 255) / 1000

/** Feedback : 0 à 0,95 (nombre de répétitions). Courbe non publiée, calibration maison. */
export const mapDelayFeedback = (v: number) => 0.95 * v

/** Reverb Time 0..255 → RT60 de 0,1 à 8 s. Non publié par Roland, calibration maison. */
export const mapReverbTime = (v: number) => 0.1 * Math.pow(80, v)

/** Pre Delay en secondes (manuel : 0..100 ms). */
export const mapReverbPreDelay = (v: number) => 0.1 * v

/** Fréquence d'un index Low Cut / High Cut ; null = Flat (pas de filtre). */
export function cutFrequency(labels: string[], index: number): number | null {
  const label = labels[Math.round(index)]
  if (!label || label === 'Flat') return null
  return label.endsWith('k') ? parseFloat(label) * 1000 : parseFloat(label)
}

/** Index de Key Shift → demi-tons. */
export const mapChordShift = (index: number) => Math.round(index) - 12

const formatTime = (sec: number) => (sec < 1 ? `${Math.round(sec * 1000)} ms` : `${sec.toFixed(2)} s`)

const formatHz = (hz: number) =>
  hz < 1 ? `${hz.toFixed(2)} Hz` : hz < 1000 ? `${hz.toFixed(hz < 10 ? 1 : 0)} Hz` : `${(hz / 1000).toFixed(hz < 10000 ? 2 : 1)} kHz`

/** Valeur lisible pour l'affichage : unités réelles quand elles ont du sens, sinon échelle 0..10. */
export function formatParam(def: ParamDef, v: number, all?: Record<ParamId, number>): string {
  if (def.stepLabels) return def.stepLabels[Math.round(v)] ?? ''
  switch (def.id) {
    case 'pulseWidth':
      return `${Math.round(mapPulseWidth(v) * 100)} %`
    case 'cutoff':
      return formatHz(mapCutoff(v))
    case 'lfoRate':
      return formatHz(mapLfoRate(v, Math.round(all?.lfoMode ?? 0) === 1))
    case 'attack':
      return formatTime(mapAttackTime(v))
    case 'decay':
      return formatTime(mapDecayTime(v))
    case 'release':
      return formatTime(mapReleaseTime(v))
    case 'volume':
      // Affiché comme sur la machine (LEVEL 0..127)
      return Math.round(v * 127).toString()
    case 'oscBendSens':
      return `±${+mapOscBend(v).toFixed(1)} st`
    case 'filterBendSens':
      return `±${+mapFilterBend(v).toFixed(1)} oct`
    case 'delayTime':
      return formatTime(mapDelayTime(v))
    case 'reverbTime':
      return formatTime(mapReverbTime(v))
    case 'reverbPreDelay':
      return `${Math.round(v * 100)} ms`
    case 'keyFollow':
    case 'delayLevel':
    case 'delayFeedback':
    case 'reverbLevel':
    case 'modDepth':
      // Échelle 0..255 de la machine
      return Math.round(v * 255).toString()
    case 'reverbDensity':
      return Math.round(v).toString()
    case 'tempo':
      return mapTempo(v).toFixed(1)
    case 'shuffle':
      return mapShuffle(v).toString()
    case 'metronomeLevel':
    case 'riserReso':
    case 'riserShape':
    case 'riserLevel':
      return Math.round(v * 100).toString()
    case 'fineTune': {
      const st = mapFineTune(v)
      return `${st >= 0 ? '+' : ''}${st.toFixed(1)} st`
    }
    case 'drawMult':
    case 'chopComb':
      return mapMultiply(v).toFixed(1)
    case 'chopOvertone':
      return mapOvertone(v).toString()
    case 'riserPos':
      return riserLabel(v)
    case 'dmSensX':
    case 'dmSensY':
      return Math.round(v).toString()
    case 'portaTime':
      return formatTime(mapPortaTime(v))
    case 'chord2Shift':
    case 'chord3Shift':
    case 'chord4Shift': {
      const st = mapChordShift(v)
      return st > 0 ? `+${st}` : `${st}`
    }
    default:
      return (v * 10).toFixed(1)
  }
}
