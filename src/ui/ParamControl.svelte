<script lang="ts">
  import { formatParam, type ParamDef, type ParamId } from '../dsp/params'
  import { isEnabled } from './paramRules'
  import Slider from './Slider.svelte'
  import Switch from './Switch.svelte'

  interface Props {
    p: ParamDef
    values: Record<ParamId, number>
    onchange: (id: ParamId, v: number) => void
  }

  let { p, values, onchange }: Props = $props()

  // Les sliders à crans (ex. Key Shift, Low Cut) travaillent en 0..1 et renvoient un index arrondi
  const toUnit = (v: number) => (p.steps ? v / (p.steps - 1) : v)
  const fromUnit = (u: number) => (p.steps ? Math.round(u * (p.steps - 1)) : u)
</script>

{#if p.stepLabels && p.control !== 'slider'}
  <Switch
    value={values[p.id]}
    label={p.label}
    options={p.stepLabels}
    disabled={!isEnabled(p, values)}
    onchange={(v) => onchange(p.id, v)}
  />
{:else}
  <Slider
    value={toUnit(values[p.id])}
    defaultValue={toUnit(p.default)}
    label={p.label}
    display={formatParam(p, values[p.id], values)}
    steps={p.steps}
    disabled={!isEnabled(p, values)}
    onchange={(u) => onchange(p.id, fromUnit(u))}
  />
{/if}
