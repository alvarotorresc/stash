<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';
  import Button from './Button.svelte';
  import CategoryPicker from './CategoryPicker.svelte';
  import InlineNotice from './InlineNotice.svelte';
  import PrioritySegment from './PrioritySegment.svelte';
  import TagInput from './TagInput.svelte';
  import Thumbnail from './Thumbnail.svelte';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';
  import type { CategoryOption, Priority, TagSuggestion, Tone } from './types';

  interface Props {
    open: boolean;
    /**
     * saved: just shared, offers to classify. queued: offline, the link waits
     * and there is nothing to classify yet. classify: an existing item
     * (from the reading view or the Clasificar button).
     */
    variant: 'saved' | 'queued' | 'classify';
    title: string;
    thumbnail?: { src?: string; tone?: Tone; icon?: IconName };
    priority?: Priority | null;
    categories?: CategoryOption[];
    category?: string | null;
    tags?: string[];
    tagSuggestions?: TagSuggestion[];
    tagQuery?: string;
    onpriority?: (value: Priority | null) => void;
    oncategory?: (id: string | null) => void;
    oncreatecategory?: (name: string) => void;
    ontagquery?: (query: string) => void;
    ontagadd?: (name: string) => void;
    ontagremove?: (name: string) => void;
    /** Listo or Vale. */
    ondone: () => void;
    /** Swipe down, Escape or scrim. Changes are kept either way. */
    onclose: () => void;
  }

  let {
    open,
    variant,
    title,
    thumbnail,
    priority = null,
    categories = [],
    category = null,
    tags = [],
    tagSuggestions = [],
    tagQuery = $bindable(''),
    onpriority = () => {},
    oncategory = () => {},
    oncreatecategory = () => {},
    ontagquery,
    ontagadd = () => {},
    ontagremove = () => {},
    ondone,
    onclose,
  }: Props = $props();

  const queued = $derived(variant === 'queued');
  const status = $derived(queued ? 'En cola' : variant === 'saved' ? 'Guardado' : null);
</script>

<BottomSheet {open} {onclose} label={status ? `${status}: ${title}` : `Clasificar: ${title}`}>
  {#snippet header()}
    <div class="saved">
      <Thumbnail
        src={thumbnail?.src}
        tone={thumbnail?.tone}
        icon={queued ? 'schedule' : thumbnail?.icon}
        size={56}
      />
      <div class="tx">
        {#if status}
          <p class="ok"><Icon name="check" size={20} />{status}</p>
        {/if}
        <p class="t">{title}</p>
      </div>
    </div>
  {/snippet}

  {#if queued}
    <div class="gap-16">
      <InlineNotice icon="cloud_off" title="Sin conexión">
        El enlace se sube y se lee en cuanto vuelva la red. Podrás clasificarlo después desde
        Pendientes.
      </InlineNotice>
    </div>
    <div class="done"><Button variant="primary" block onclick={ondone}>Vale</Button></div>
  {:else}
    {#if variant === 'saved'}
      <p class="hint">Ya está en Stash. Si quieres, clasifícalo ahora.</p>
    {/if}
    <div class="controls">
      <PrioritySegment value={priority} onchange={onpriority} />
      <CategoryPicker
        {categories}
        selected={category}
        onselect={oncategory}
        oncreate={oncreatecategory}
      />
      <TagInput
        {tags}
        suggestions={tagSuggestions}
        bind:query={tagQuery}
        onquery={ontagquery}
        onadd={ontagadd}
        onremove={ontagremove}
      />
    </div>
    <div class="done"><Button variant="primary" block onclick={ondone}>Listo</Button></div>
    {#if variant === 'saved'}
      <p class="small">Si cierras sin tocar nada, se queda en Sin clasificar.</p>
    {/if}
  {/if}
</BottomSheet>

<style>
  .saved {
    display: flex;
    gap: 12px;
    align-items: center;
    padding-bottom: 2px;
  }
  .tx {
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--accent-text);
    font-size: 15px;
    font-weight: 700;
  }
  .t {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--fs-title);
    line-height: 1.3;
    font-weight: 600;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .hint {
    margin-top: 14px;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 14px;
  }
  .gap-16 {
    margin-top: 16px;
  }
  .done {
    display: flex;
    margin-top: 18px;
  }
  .small {
    margin-top: 10px;
    color: var(--muted);
    font-size: var(--fs-meta);
    text-align: center;
  }
</style>
