import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryList } from './index';

const items = [
  { id: 'a', name: 'Trabajo', count: 12 },
  { id: 'b', name: 'Casa', count: 7 },
  { id: 'c', name: 'Madrid', count: 5 },
];

function setup(extra: Record<string, unknown> = {}) {
  const props = {
    items,
    label: 'Categorías',
    onreorder: vi.fn(),
    onrename: vi.fn(),
    ondelete: vi.fn(),
    deleteMessage: (item: { count: number }) =>
      `Sus ${item.count} guardados pasan a Sin clasificar. No se pierde nada.`,
    ...extra,
  };
  const view = render(CategoryList, props);
  return { ...props, ...view };
}

describe('CategoryList', () => {
  it('should list each category with its count and a drag handle', () => {
    setup();

    const list = screen.getByRole('list', { name: 'Categorías' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Mover Casa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar Casa' })).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('should not offer reordering for tags', () => {
    setup({ reorderable: false });

    expect(screen.queryByRole('button', { name: /^Mover/ })).toBeNull();
  });

  it('should move a category with the arrow keys on its handle', async () => {
    const { onreorder } = setup();
    const handle = screen.getByRole('button', { name: 'Mover Casa' });

    await fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(onreorder).toHaveBeenLastCalledWith(['b', 'a', 'c']);
    expect(screen.getByRole('status').textContent).toBe('Casa, posición 1 de 3');

    await fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onreorder).toHaveBeenLastCalledWith(['a', 'c', 'b']);
  });

  it('should not move past the ends or on other keys', async () => {
    const { onreorder } = setup();

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Mover Trabajo' }), {
      key: 'ArrowUp',
    });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Mover Madrid' }), {
      key: 'ArrowDown',
    });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Mover Casa' }), { key: 'x' });

    expect(onreorder).not.toHaveBeenCalled();
  });

  it('should rename in the row and go back to the list', async () => {
    const { onrename } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    const input = screen.getByLabelText('Renombrar «Casa»');
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: 'Hogar' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onrename).toHaveBeenCalledWith('b', 'Hogar');
    expect(screen.queryByLabelText('Renombrar «Casa»')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Editar Casa' }));
  });

  it('should save with Enter and cancel with Escape', async () => {
    const { onrename } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Trabajo' }));
    const input = screen.getByLabelText('Renombrar «Trabajo»');
    await fireEvent.input(input, { target: { value: 'Oficina' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onrename).toHaveBeenCalledWith('a', 'Oficina');

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Trabajo' }));
    await fireEvent.keyDown(screen.getByLabelText('Renombrar «Trabajo»'), { key: 'Escape' });
    expect(screen.queryByLabelText('Renombrar «Trabajo»')).toBeNull();
    expect(onrename).toHaveBeenCalledOnce();
  });

  it('should not rename to an empty or identical name', async () => {
    const { onrename } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    await fireEvent.keyDown(screen.getByLabelText('Renombrar «Casa»'), { key: 'a' });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    await fireEvent.input(screen.getByLabelText('Renombrar «Casa»'), { target: { value: '  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onrename).not.toHaveBeenCalled();
  });

  it('should move with Subir and Bajar while editing', async () => {
    const { onreorder } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Trabajo' }));
    const up = screen.getByRole('button', { name: 'Subir' });
    expect(up.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(up);
    expect(onreorder).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Bajar' }));
    expect(onreorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('should confirm deletion in the row, saying what happens', async () => {
    const { ondelete } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    const confirm = screen.getByRole('group', { name: /¿Borrar Casa\?/ });
    expect(confirm.textContent).toContain('Sus 7 guardados pasan a Sin clasificar.');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancelar' }));

    await fireEvent.click(within(confirm).getByRole('button', { name: 'Borrar' }));
    expect(ondelete).toHaveBeenCalledWith('b');
  });

  it('should keep the item when deletion is cancelled', async () => {
    const { ondelete } = setup({ reorderable: false });

    await fireEvent.click(screen.getByRole('button', { name: 'Editar Casa' }));
    expect(screen.queryByRole('button', { name: 'Subir' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Editar Casa' })).toBeTruthy();
  });
});

describe('CategoryList drag', () => {
  let height: PropertyDescriptor | undefined;

  beforeEach(() => {
    height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 56,
    });
  });

  afterEach(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  });

  const pointer = (type: string, clientY: number, extra = {}) => {
    const event = new Event(type, { bubbles: true }) as PointerEvent;
    Object.assign(event, { clientY, pointerId: 1, isPrimary: true, ...extra });
    return event;
  };

  it('should lift the row and drop it in a new place', async () => {
    const { onreorder, container } = setup();
    const handle = screen.getByRole('button', { name: 'Mover Trabajo' });

    handle.dispatchEvent(pointer('pointerdown', 100));
    await Promise.resolve();
    expect(container.querySelector('.lift')).toBeTruthy();

    handle.dispatchEvent(pointer('pointermove', 140));
    handle.dispatchEvent(pointer('pointermove', 200));
    await Promise.resolve();
    const names = [...container.querySelectorAll('.name')].map((n) => n.textContent);
    expect(names).toEqual(['Casa', 'Madrid', 'Trabajo']);

    handle.dispatchEvent(pointer('pointerup', 200));
    expect(onreorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('should reorder upwards and finish on pointer cancel', () => {
    const { onreorder } = setup();
    const handle = screen.getByRole('button', { name: 'Mover Casa' });

    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 110));
    handle.dispatchEvent(pointer('pointermove', 70));
    handle.dispatchEvent(pointer('pointercancel', 100));

    expect(onreorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('should ignore other fingers and stray moves', () => {
    const { onreorder } = setup();
    const handle = screen.getByRole('button', { name: 'Mover Casa' });

    handle.dispatchEvent(pointer('pointermove', 300));
    handle.dispatchEvent(pointer('pointerup', 300));
    handle.dispatchEvent(pointer('pointerdown', 100, { isPrimary: false }));
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointerdown', 100, { pointerId: 2 }));
    handle.dispatchEvent(pointer('pointermove', 400, { pointerId: 2 }));
    handle.dispatchEvent(pointer('pointerup', 400, { pointerId: 2 }));
    handle.dispatchEvent(pointer('pointermove', 105));
    handle.dispatchEvent(pointer('pointerup', 105));

    expect(onreorder).not.toHaveBeenCalled();
  });
});
