<script lang="ts">
  import type { PrmExport } from '../audio/prm'

  let {
    onImport,
    onExport,
  }: {
    /** Retourne les avertissements de l'import ; lève une erreur si le fichier est illisible. */
    onImport: (text: string) => string[]
    onExport: () => PrmExport
  } = $props()

  let input: HTMLInputElement
  // Nom réutilisé à l'export : la machine restaure d'après le nom du fichier (S1_PTN<banque>-<n°>.PRM)
  let fileName = $state('S1_PTN1-01.PRM')
  let messages: string[] = $state([])
  let error = $state('')

  async function onFile() {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    error = ''
    try {
      messages = onImport(await file.text())
      fileName = file.name
    } catch (e) {
      messages = []
      error = e instanceof Error ? e.message : String(e)
    }
  }

  function save() {
    const { text, warnings } = onExport()
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    error = ''
    messages = warnings
  }
</script>

<div class="prm">
  <button type="button" onclick={() => input.click()}>Importer .PRM</button>
  <button type="button" onclick={save}>Exporter .PRM</button>
  <input bind:this={input} type="file" accept=".prm,.PRM" onchange={onFile} hidden />
  {#if error}<span class="note error">{error}</span>{/if}
</div>
{#if messages.length}
  <ul class="messages" role="status">
    {#each messages as m (m)}<li>{m}</li>{/each}
    <li><button type="button" class="plain" onclick={() => (messages = [])}>Fermer</button></li>
  </ul>
{/if}

<style>
  .prm {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  button {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .note.error {
    color: var(--danger);
  }
  .messages {
    flex-basis: 100%;
    margin: 0;
    padding: 8px 12px 8px 28px;
    font-size: 0.8rem;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .messages li:last-child {
    list-style: none;
    margin-top: 4px;
  }
  .plain {
    border: none;
    padding: 0;
    background: none;
    text-decoration: underline;
  }
</style>
