<script lang="ts">
  import { tick } from 'svelte';
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
  import Icon from './icons/Icon.svelte';

  export interface ListEntry {
    id: string;
    name: string;
    /** Saved items that use it. */
    count: number;
  }

  interface Props {
    items: ListEntry[];
    /** Accessible name of the list. */
    label: string;
    /** Categories reorder (drag by the handle, arrow keys, Subir/Bajar); tags do not. */
    reorderable?: boolean;
    onreorder?: (ids: string[]) => void;
    onrename: (id: string, name: string) => void;
    ondelete: (id: string) => void;
    /** What deleting does, said in the row: "Sus 4 guardados pasan a Sin clasificar…". */
    deleteMessage: (item: ListEntry) => string;
  }

  let {
    items,
    label,
    reorderable = true,
    onreorder = () => {},
    onrename,
    ondelete,
    deleteMessage,
  }: Props = $props();

  const uid = $props.id();
  let editing = $state<string | null>(null);
  let confirming = $state<string | null>(null);
  let draft = $state('');
  let announcement = $state('');
  let list = $state<HTMLUListElement>();

  /** Order while a drag is in progress; null otherwise. */
  let dragOrder = $state<string[] | null>(null);
  let dragId = $state<string | null>(null);
  let drag: { pointer: number; startY: number; offset: number } | null = null;

  const byId = $derived(new Map(items.map((item) => [item.id, item])));
  const shown = $derived(
    dragOrder ? dragOrder.map((id) => byId.get(id)).filter((i) => i !== undefined) : items,
  );

  function rowOf(id: string) {
    return list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? null;
  }

  async function focusIn(id: string, selector: string) {
    await tick();
    rowOf(id)?.querySelector<HTMLElement>(selector)?.focus();
  }

  function startEdit(item: ListEntry) {
    editing = item.id;
    confirming = null;
    draft = item.name;
    focusIn(item.id, 'input');
  }

  function cancel(id: string) {
    editing = null;
    confirming = null;
    focusIn(id, '.edit-btn');
  }

  function save(item: ListEntry) {
    const name = draft.trim();
    if (name && name !== item.name) onrename(item.id, name);
    cancel(item.id);
  }

  function askDelete(id: string) {
    editing = null;
    confirming = id;
    focusIn(id, '.keep');
  }

  function remove(id: string) {
    confirming = null;
    ondelete(id);
  }

  function move(id: string, delta: -1 | 1, focusSelector: string) {
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    onreorder(ids);
    announcement = `${byId.get(id)?.name}, posición ${to + 1} de ${ids.length}`;
    focusIn(id, focusSelector);
  }

  function onhandlekey(event: KeyboardEvent, id: string) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(id, event.key === 'ArrowUp' ? -1 : 1, '.handle');
    }
  }

  function onpointerdown(event: PointerEvent, id: string) {
    if (drag || !event.isPrimary) return;
    drag = { pointer: event.pointerId, startY: event.clientY, offset: 0 };
    dragId = id;
    dragOrder = items.map((item) => item.id);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onpointermove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer || !dragOrder || !dragId) return;
    let offset = event.clientY - drag.startY;
    const index = dragOrder.indexOf(dragId);
    const direction = offset > 0 ? 1 : -1;
    const neighbourId = dragOrder[index + direction];
    const neighbour = neighbourId ? rowOf(neighbourId) : null;
    // Past half of the neighbour: swap, and measure from the new slot.
    if (neighbourId && neighbour && Math.abs(offset) > neighbour.offsetHeight / 2) {
      const next = [...dragOrder];
      next[index] = neighbourId;
      next[index + direction] = dragId;
      dragOrder = next;
      drag.startY += direction * neighbour.offsetHeight;
      offset = event.clientY - drag.startY;
    }
    drag.offset = offset;
    const row = rowOf(dragId);
    if (row) row.style.setProperty('--drag-y', `${offset}px`);
  }

  function onpointerup(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer || !dragId) return;
    const before = items.map((item) => item.id).join('\n');
    const after = dragOrder ?? [];
    rowOf(dragId)?.style.removeProperty('--drag-y');
    drag = null;
    dragId = null;
    dragOrder = null;
    if (after.join('\n') !== before) onreorder(after);
  }
</script>

{#if reorderable}
  <p id="reorder-hint-{uid}" class="visually-hidden">
    Con el asa enfocada, usa las flechas arriba y abajo para mover.
  </p>
{/if}
<ul bind:this={list} class="list" aria-label={label}>
  {#each shown as item, index (item.id)}
    <li class="item" data-id={item.id}>
      {#if editing === item.id}
        <div class="panel">
          <label class="lab" for="rename-{uid}-{item.id}">Renombrar «{item.name}»</label>
          <input
            id="rename-{uid}-{item.id}"
            class="field"
            bind:value={draft}
            autocomplete="off"
            enterkeyhint="done"
            onkeydown={(event) => {
              if (event.key === 'Enter') save(item);
              if (event.key === 'Escape') {
                event.stopPropagation();
                cancel(item.id);
              }
            }}
          />
          <div class="acts">
            <Button onclick={() => cancel(item.id)}>Cancelar</Button>
            <Button variant="primary" onclick={() => save(item)}>Guardar</Button>
          </div>
          <div class="acts">
            {#if reorderable}
              <Button
                icon="keyboard_arrow_up"
                class="up"
                unavailable={index === 0}
                onclick={() => move(item.id, -1, '.up')}>Subir</Button
              >
              <Button
                icon="keyboard_arrow_down"
                class="down"
                unavailable={index === shown.length - 1}
                onclick={() => move(item.id, 1, '.down')}>Bajar</Button
              >
            {/if}
            <Button variant="danger" icon="delete" onclick={() => askDelete(item.id)}>Borrar</Button
            >
          </div>
        </div>
      {:else if confirming === item.id}
        <div class="panel" role="group" aria-labelledby="confirm-{uid}-{item.id}">
          <p id="confirm-{uid}-{item.id}">
            <b>¿Borrar {item.name}?</b>
            {deleteMessage(item)}
          </p>
          <div class="acts">
            <Button class="keep" onclick={() => cancel(item.id)}>Cancelar</Button>
            <Button variant="danger" onclick={() => remove(item.id)}>Borrar</Button>
          </div>
        </div>
      {:else}
        <div class="row" class:lift={dragId === item.id} class:plain={!reorderable}>
          {#if reorderable}
            <button
              type="button"
              class="handle"
              aria-label="Mover {item.name}"
              aria-describedby="reorder-hint-{uid}"
              onkeydown={(event) => onhandlekey(event, item.id)}
              onpointerdown={(event) => onpointerdown(event, item.id)}
              {onpointermove}
              {onpointerup}
              onpointercancel={onpointerup}
            >
              <Icon name="drag_indicator" />
            </button>
          {/if}
          <span class="name">{item.name}</span>
          <span class="n">{item.count}</span>
          <IconButton
            class="edit-btn"
            icon="edit"
            label="Editar {item.name}"
            onclick={() => startEdit(item)}
          />
        </div>
      {/if}
    </li>
  {/each}
</ul>
<p class="visually-hidden" role="status">{announcement}</p>

<style>
  .list {
    margin: 0 12px;
    padding: 0 14px;
    list-style: none;
    border-radius: var(--radius-block);
    background: var(--surface);
  }
  .item:not(:first-child) {
    border-top: 1px solid var(--line);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 56px;
    background: var(--surface);
    transition:
      transform var(--dur-lift) var(--ease-out),
      box-shadow var(--dur-lift) var(--ease-out);
  }
  .row.plain {
    padding-left: 2px;
  }
  .lift {
    z-index: 1;
    margin: 0 -8px;
    padding: 0 8px;
    border-radius: var(--radius-block);
    outline: 2px solid var(--accent);
    box-shadow: var(--shadow-lift);
    transform: translateY(var(--drag-y, 0)) scale(var(--lift-scale));
    transition: box-shadow var(--dur-lift) var(--ease-out);
  }
  .handle {
    display: grid;
    place-items: center;
    width: 36px;
    height: 44px;
    margin-left: -10px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plain .name {
    font-weight: 400;
  }
  .n {
    margin-right: 2px;
    color: var(--muted);
    font-size: 14px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0;
  }
  .lab {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .field {
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--fs-input);
  }
  .field:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  p {
    margin: 0;
    font-size: 14.5px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .acts :global(.btn) {
    flex: 1;
  }
</style>
