import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { CategoryPicker, Chip, PrioritySegment, Tag, TagInput } from './index';
import { text } from './test-utils';

describe('PrioritySegment', () => {
  it('should render the three priorities as a labelled group', () => {
    render(PrioritySegment, { value: 'medium', onchange: () => {} });

    const group = screen.getByRole('group', { name: 'Prioridad' });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Media' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Alta' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('should select another priority', async () => {
    const onchange = vi.fn();
    render(PrioritySegment, { value: null, onchange });

    await fireEvent.click(screen.getByRole('button', { name: 'Alta' }));

    expect(onchange).toHaveBeenCalledWith('high');
  });

  it('should clear the priority when the active segment is pressed', async () => {
    const onchange = vi.fn();
    render(PrioritySegment, { value: 'low', onchange });

    await fireEvent.click(screen.getByRole('button', { name: 'Baja' }));

    expect(onchange).toHaveBeenCalledWith(null);
  });
});

describe('Chip', () => {
  it('should be a toggle button when pressable', async () => {
    const onclick = vi.fn();
    render(Chip, { children: text('Casa'), selected: true, onclick });
    const chip = screen.getByRole('button', { name: 'Casa' });

    await fireEvent.click(chip);

    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('should be plain text without onclick', () => {
    const { container } = render(Chip, { children: text('Alta'), icon: 'add' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('span.chip svg')).toBeTruthy();
  });
});

describe('CategoryPicker', () => {
  const categories = [
    { id: 'c1', name: 'Recetas' },
    { id: 'c2', name: 'Casa' },
  ];

  it('should select and clear a category', async () => {
    const onselect = vi.fn();
    render(CategoryPicker, { categories, selected: 'c1', onselect, oncreate: () => {} });

    expect(screen.getByRole('group', { name: 'Categoría' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Casa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Recetas' }));

    expect(onselect).toHaveBeenNthCalledWith(1, 'c2');
    expect(onselect).toHaveBeenNthCalledWith(2, null);
  });

  it('should create a category inline with Enter', async () => {
    const oncreate = vi.fn();
    render(CategoryPicker, { categories, selected: null, onselect: () => {}, oncreate });

    await fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    const input = screen.getByRole('textbox', { name: 'Nombre de la categoría nueva' });
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: '  Viajes ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(oncreate).toHaveBeenCalledWith('Viajes');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nueva' })).toBeTruthy();
  });

  it('should create with the Añadir button and ignore an empty name', async () => {
    const oncreate = vi.fn();
    render(CategoryPicker, { categories, selected: null, onselect: () => {}, oncreate });

    await fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    expect(oncreate).not.toHaveBeenCalled();
  });

  it('should cancel with Escape and ignore other keys', async () => {
    const oncreate = vi.fn();
    render(CategoryPicker, { categories, selected: null, onselect: () => {}, oncreate });

    await fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'a' });
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(oncreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('Tag', () => {
  it('should render without a remove button by default', () => {
    render(Tag, { name: 'otoño' });

    expect(screen.getByText('otoño')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should be removable with its ×', async () => {
    const onremove = vi.fn();
    render(Tag, { name: 'otoño', onremove });

    await fireEvent.click(screen.getByRole('button', { name: 'Quitar otoño' }));

    expect(onremove).toHaveBeenCalledOnce();
  });
});

describe('TagInput', () => {
  const suggestions = [
    { name: 'cena', count: 6 },
    { name: 'cenas rápidas', count: 1 },
    { name: 'cenar', count: 1 },
    { name: 'centeno', count: 1 },
    { name: 'cenefa', count: 1 },
  ];

  function setup(props: Partial<{ tags: string[]; query: string }> = {}) {
    const onadd = vi.fn();
    const onremove = vi.fn();
    const onquery = vi.fn();
    render(TagInput, { tags: ['otoño'], suggestions, onadd, onremove, onquery, ...props });
    const input = screen.getByRole('combobox', { name: 'Etiquetas' });
    return { input, onadd, onremove, onquery };
  }

  it('should list up to four suggestions with their use count while typing', async () => {
    const { input, onquery } = setup();

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'cen' } });

    expect(onquery).toHaveBeenCalledWith('cen');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]?.textContent).toBe('cenaen 6 guardados');
    expect(options[1]?.textContent).toContain('en 1 guardado');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('should add the highlighted suggestion with Enter', async () => {
    const { input, onadd } = setup();

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'cen' } });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onadd).toHaveBeenCalledWith('cenas rápidas');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('should wrap the highlight with the arrow keys and add with a comma', async () => {
    const { input, onadd } = setup();

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'cen' } });
    await fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input.getAttribute('aria-activedescendant')).toMatch(/-3$/);
    await fireEvent.keyDown(input, { key: ',' });
    expect(onadd).toHaveBeenCalledWith('centeno');
  });

  it('should add a suggestion when it is tapped', async () => {
    const { input, onadd } = setup();

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'cen' } });
    await fireEvent.pointerDown(screen.getByRole('option', { name: /cenar/ }));

    expect(onadd).toHaveBeenCalledWith('cenar');
  });

  it('should create the typed tag when nothing matches', async () => {
    const onadd = vi.fn();
    render(TagInput, { tags: [], suggestions: [], onadd, onremove: () => {} });
    const input = screen.getByRole('combobox');

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: ' viaje ' } });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onadd).toHaveBeenCalledWith('viaje');
  });

  it('should not add an empty or repeated tag', async () => {
    const { input, onadd } = setup();

    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.input(input, { target: { value: 'otoño' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onadd).not.toHaveBeenCalled();
  });

  it('should close the list with Escape and reopen when typing', async () => {
    const { input } = setup();

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'cen' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.keyDown(input, { key: 'ArrowUp' });

    await fireEvent.input(input, { target: { value: 'cena' } });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.blur(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('should remove the last tag with Backspace on an empty field', async () => {
    const { input, onremove } = setup();

    await fireEvent.keyDown(input, { key: 'Backspace' });

    expect(onremove).toHaveBeenCalledWith('otoño');
  });

  it('should keep tags when Backspace deletes text, and remove one with its ×', async () => {
    const { input, onremove } = setup({ query: 'ce' });

    await fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onremove).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Quitar otoño' }));
    expect(onremove).toHaveBeenCalledWith('otoño');
  });

  it('should do nothing on Backspace with no tags', async () => {
    const onremove = vi.fn();
    render(TagInput, { tags: [], suggestions: [], onadd: () => {}, onremove });

    await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' });

    expect(onremove).not.toHaveBeenCalled();
  });
});
