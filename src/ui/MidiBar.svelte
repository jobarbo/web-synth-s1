<script lang="ts">
  import { MidiInput, midiSupported, S1_DEFAULT_CHANNEL, type MidiEvent } from '../audio/midi'

  let { onEvent }: { onEvent: (e: MidiEvent) => void } = $props()

  let midi: MidiInput | null = null
  let connected = $state(false)
  let inputs: { id: string; name: string }[] = $state([])
  let selected = $state('all')
  let channel = $state(0)
  let error = $state('')
  let activity = $state(false)
  let activityTimer: ReturnType<typeof setTimeout> | undefined

  const supported = midiSupported()

  async function connect() {
    error = ''
    try {
      midi = new MidiInput(
        (e) => {
          // Témoin d'activité, comme la LED MIDI d'un appareil
          activity = true
          clearTimeout(activityTimer)
          activityTimer = setTimeout(() => (activity = false), 120)
          onEvent(e)
        },
        (list) => (inputs = list),
      )
      midi.channel = channel
      await midi.connect()
      connected = true
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  $effect(() => {
    midi?.select(selected)
  })

  $effect(() => {
    if (midi) midi.channel = channel
  })
</script>

<div class="midi">
  {#if !supported}
    <span class="note">MIDI non pris en charge par ce navigateur (essayer Chrome ou Edge)</span>
  {:else if !connected}
    <button type="button" onclick={connect}>Connecter MIDI</button>
    {#if error}<span class="note error">{error}</span>{/if}
  {:else}
    <span class="led" class:on={activity} aria-hidden="true"></span>
    <label>
      <span class="visually-hidden">Entrée MIDI</span>
      <select bind:value={selected}>
        <option value="all">Toutes les entrées ({inputs.length})</option>
        {#each inputs as input (input.id)}
          <option value={input.id}>{input.name}</option>
        {/each}
      </select>
    </label>
    <label>
      Canal
      <select bind:value={channel}>
        <option value={0}>Omni</option>
        {#each Array.from({ length: 16 }, (_, i) => i + 1) as ch (ch)}
          <option value={ch}>{ch}{ch === S1_DEFAULT_CHANNEL ? ' (S-1)' : ''}</option>
        {/each}
      </select>
    </label>
  {/if}
</div>

<style>
  .midi {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  button,
  select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
    cursor: pointer;
  }
  select {
    border-radius: 6px;
    padding: 4px 8px;
    max-width: 200px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
  }
  .led.on {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .note.error {
    color: var(--danger);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
