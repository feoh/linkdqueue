<script lang="ts">
  import type { Settings } from '../api/types';
  import { THEMES, TEXT_SCALES, normalizeDisplay } from '../state/display';

  let {
    settings,
    onSave,
  }: { settings: Settings; onSave: (theme: string, textScale: number) => Promise<void> } = $props();
  let theme = $state<(typeof THEMES)[number]>('system');
  let textScale = $state<(typeof TEXT_SCALES)[number]>(1);
  let saving = $state(false);
  let error = $state('');

  $effect(() => {
    const display = normalizeDisplay(settings.display);
    theme = display.theme;
    textScale = display.textScale;
  });

  async function save() {
    saving = true;
    error = '';
    try {
      await onSave(theme, textScale);
    } catch {
      error = 'Preferences could not be saved. Your previous settings remain active; try again.';
    } finally {
      saving = false;
    }
  }

  const labels: Record<string, string> = {
    system: 'System',
    catppuccinMocha: 'Catppuccin Mocha',
    catppuccinLatte: 'Catppuccin Latte',
    dracula: 'Dracula',
    tokyoNight: 'Tokyo Night',
    tokyoDay: 'Tokyo Day',
    gruvbox: 'Gruvbox',
    oneDark: 'One Dark',
  };
</script>

<section class="display-preferences" aria-labelledby="display-preferences-title">
  <h2 id="display-preferences-title">Display</h2>
  <label>
    Theme
    <select bind:value={theme} aria-label="Color theme">
      {#each THEMES as option (option)}<option value={option}>{labels[option]}</option>{/each}
    </select>
  </label>
  <label>
    Text size
    <select bind:value={textScale} aria-label="Text size">
      {#each TEXT_SCALES as option (option)}<option value={option}
          >{Math.round(option * 100)}%</option
        >{/each}
    </select>
  </label>
  <button class="primary-button" type="button" disabled={saving} onclick={save}
    >{saving ? 'Saving…' : 'Save display preferences'}</button
  >
  {#if error}<p class="preference-error" role="alert">{error}</p>{/if}
</section>
