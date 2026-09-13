<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent, Event, ClipboardEvent */
  type Props = {
    selectedNames?: string[];
    suggestions?: string[];
    onChange?: (names: string[]) => void;
    id?: string;
    label?: string;
  };

  let {
    selectedNames = [],
    suggestions = [],
    onChange,
    id = 'bookmark-tags',
    label = 'Tags',
  }: Props = $props();
  let draft = $state('');
  let error = $state('');

  const selected = $derived(selectedNames);
  const availableSuggestions = $derived(
    suggestions.filter(
      (name) =>
        !selected.includes(name) &&
        (!draft || name.toLocaleLowerCase().includes(draft.toLocaleLowerCase())),
    ),
  );

  // D02: names are single server tag tokens. Delimiters are rejected rather than
  // silently changed; Linkding owns any server-side name normalization.
  function validateName(name: string): string | null {
    if (!name) return null;
    if (/[\s,()"]/.test(name))
      return 'Tag names cannot contain spaces, commas, parentheses, or quotes.';
    return null;
  }

  function emit(names: string[]) {
    onChange?.(names);
  }

  function add(value = draft) {
    const names = value
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!names.length) return;
    const invalid = names.map(validateName).find(Boolean);
    if (invalid) {
      error = invalid;
      return;
    }
    const additions = [...new Set(names)].filter((name) => !selected.includes(name));
    error = '';
    if (!additions.length) {
      draft = '';
      return;
    }
    emit([...selected, ...additions]);
    draft = '';
  }

  function remove(name: string) {
    emit(selected.filter((current) => current !== name));
    error = '';
  }

  function input(event: Event) {
    draft = (event.currentTarget as HTMLInputElement).value;
    error = '';
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && selected.length) {
      event.preventDefault();
      remove(selected[selected.length - 1]);
    }
  }

  function paste(event: ClipboardEvent) {
    // This is ordinary paste: use only the text supplied by the input event.
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;
    event.preventDefault();
    const parts = text.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) add(part);
  }
</script>

<div class="tag-input">
  <label for={id}>{label}</label>
  <div class="tag-control" role="group" aria-label={label}>
    {#each selected as name (name)}
      <span class="tag-chip">
        {name}
        <button type="button" aria-label={`Remove ${name}`} onclick={() => remove(name)}>×</button>
      </span>
    {/each}
    <input
      {id}
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={`${id}-suggestions`}
      aria-expanded={availableSuggestions.length > 0}
      value={draft}
      oninput={input}
      onkeydown={keydown}
      onpaste={paste}
      placeholder={selected.length ? '' : 'Add tags'}
    />
  </div>
  {#if error}<p class="field-error" role="alert">{error}</p>{/if}
  {#if availableSuggestions.length}
    <div id={`${id}-suggestions`} class="tag-suggestions" role="listbox">
      {#each availableSuggestions.slice(0, 8) as name (name)}
        <button type="button" role="option" aria-selected="false" onclick={() => add(name)}>
          {name}
        </button>
      {/each}
    </div>
  {/if}
</div>
