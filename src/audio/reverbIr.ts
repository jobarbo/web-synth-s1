import { Noise } from '../dsp/osc'

/** Ordre du manuel S-1 (EFX > REVERB > tyPE). */
export const ReverbType = { Ambience: 0, Room: 1, Hall1: 2, Hall2: 3, Plate: 4, Spring: 5, Modulate: 6 } as const

interface Profile {
  /** Multiplie le temps demandé (petits espaces = queue plus courte). */
  timeScale: number
  /** Montée de la queue en secondes (diffusion progressive des grands espaces). */
  buildUp: number
  /** Amortissement des aigus au fil de la queue : 0 = brillant, 1 = sombre. */
  damping: number
  /** Réflexions précoces : délais en secondes. */
  early: number[]
}

/*
 * Profils approximatifs des 7 types du S-1, d'après leur description dans le manuel
 * (Hall1 « clair et spacieux », Hall2 « doux », Plate métallique, etc.). Pas de mesure sur machine.
 */
const PROFILES: Profile[] = [
  { timeScale: 0.35, buildUp: 0.002, damping: 0.5, early: [0.011, 0.019, 0.027, 0.041] }, // Ambience
  { timeScale: 0.55, buildUp: 0.004, damping: 0.45, early: [0.005, 0.009, 0.014, 0.021, 0.026] }, // Room
  { timeScale: 1, buildUp: 0.025, damping: 0.25, early: [0.017, 0.031, 0.047] }, // Hall 1
  { timeScale: 1, buildUp: 0.035, damping: 0.65, early: [0.021, 0.037, 0.055] }, // Hall 2
  { timeScale: 0.9, buildUp: 0.001, damping: 0.15, early: [] }, // Plate
  { timeScale: 0.7, buildUp: 0.001, damping: 0.4, early: [] }, // Spring (chirps ajoutés à part)
  { timeScale: 1, buildUp: 0.025, damping: 0.35, early: [0.017, 0.031, 0.047] }, // Modulate (modulation dans le graphe)
]

export interface ReverbIrOptions {
  type: number
  /** RT60 en secondes. */
  rt60: number
  /** 0..10 (manuel : dEnS). Faible = queue granuleuse, élevée = queue lisse. */
  density: number
  sampleRate: number
  seed?: number
}

const MAX_SECONDS = 10

/**
 * Réponse impulsionnelle stéréo synthétique : bruit à décroissance exponentielle (RT60),
 * filtré de plus en plus sombre avec le temps, plus réflexions précoces selon le type.
 * Normalisée en énergie pour que le Level donne le même niveau perçu quel que soit le type.
 */
export function generateReverbIr(o: ReverbIrOptions): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const profile = PROFILES[o.type] ?? PROFILES[ReverbType.Hall1]
  const rt60 = Math.max(0.05, o.rt60 * profile.timeScale)
  const length = Math.max(1, Math.floor(Math.min(rt60 * 1.1, MAX_SECONDS) * o.sampleRate))
  // Probabilité qu'un échantillon porte une impulsion : densité 0 = clairsemé, 10 = continu
  const d = Math.min(10, Math.max(0, o.density)) / 10
  const pulseProb = 0.01 + 0.99 * d * d
  const pulseGain = 1 / Math.sqrt(pulseProb)

  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)]
  for (let ch = 0; ch < 2; ch++) {
    const data = channels[ch]
    const noise = new Noise((o.seed ?? 0x51f15e) + ch * 104729)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const t = i / o.sampleRate
      const decay = Math.exp((-6.91 * t) / rt60)
      const build = profile.buildUp > 0 ? 1 - Math.exp(-t / profile.buildUp) : 1
      const rnd = noise.next()
      const pulse = Math.abs(rnd) < pulseProb ? (rnd >= 0 ? 1 : -1) * pulseGain : noise.next() * d
      // Passe-bas à un pôle qui se ferme avec le temps : les aigus meurent avant les graves
      const darkness = profile.damping * Math.min(1, t / rt60) * 0.95
      lp = pulse * (1 - darkness) + lp * darkness
      data[i] = lp * decay * build
    }
    // Réflexions précoces : impulsions nettes, légèrement décalées entre gauche et droite
    for (let k = 0; k < profile.early.length; k++) {
      const idx = Math.floor((profile.early[k] + ch * 0.0013 * (k + 1)) * o.sampleRate)
      if (idx < length) data[idx] += (0.6 / (k + 1)) * (k % 2 === ch ? 1 : -1) * 4
    }
    if (o.type === ReverbType.Spring) addSpringChirps(data, rt60, o.sampleRate, ch)
  }

  normalize(channels)
  return channels
}

/**
 * Ressort : chaque aller-retour dans le ressort renvoie un « chirp » descendant (dispersion),
 * ce qui donne le « boing » caractéristique. Période d'aller-retour ~35 ms.
 */
function addSpringChirps(data: Float32Array, rt60: number, sampleRate: number, ch: number) {
  const period = 0.035 + ch * 0.0021
  const chirpLen = Math.floor(0.03 * sampleRate)
  for (let start = 0.004; start < rt60; start += period) {
    const amp = Math.exp((-6.91 * start) / rt60) * 6
    const offset = Math.floor(start * sampleRate)
    let phase = 0
    for (let i = 0; i < chirpLen && offset + i < data.length; i++) {
      const x = i / chirpLen
      // Balayage de ~4 kHz vers ~300 Hz
      const freq = 300 + 3700 * (1 - x) * (1 - x)
      phase += (2 * Math.PI * freq) / sampleRate
      data[offset + i] += Math.sin(phase) * amp * (1 - x)
    }
  }
}

function normalize(channels: Float32Array[]) {
  let energy = 0
  for (const data of channels) for (let i = 0; i < data.length; i++) energy += data[i] * data[i]
  const gain = energy > 0 ? 1 / Math.sqrt(energy / channels.length) : 0
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain
}
