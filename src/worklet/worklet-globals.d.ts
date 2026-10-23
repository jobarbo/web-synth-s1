// Globals de l'AudioWorkletGlobalScope, absents de la lib DOM de TypeScript.

interface AudioParamDescriptor {
  name: string
  defaultValue?: number
  minValue?: number
  maxValue?: number
  automationRate?: 'a-rate' | 'k-rate'
}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}

declare function registerProcessor(
  name: string,
  ctor: (new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor) & {
    parameterDescriptors?: AudioParamDescriptor[]
  },
): void

declare const sampleRate: number
