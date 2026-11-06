import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet, InlineNotice, SaveSheet } from './index';
import { text } from './test-utils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BottomSheet', () => {
  function setup(open = true) {
    const onclose = vi.fn();
    const view = render(BottomSheet, {
      open,
      onclose,
      label: 'Guardado',
      children: text('contenido'),
    });
    return { onclose, ...view };
  }

  it('should render nothing while closed', () => {
    setup(false);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should open as a modal dialog and take focus', () => {
    setup();

    const dialog = screen.getByRole('dialog', { name: 'Guardado' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(dialog.parentElement?.classList.contains('shown')).toBe(true);
  });

  it('should close with Escape', async () => {
    const { onclose } = setup();

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onclose).toHaveBeenCalledOnce();
  });

  it('should close when the scrim is tapped', async () => {
    const { onclose } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onclose).toHaveBeenCalledOnce();
  });

  it('should stay mounted during the exit and then restore focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = setup();

    await rerender({ open: false });
    expect(screen.getByRole('dialog').parentElement?.classList.contains('shown')).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('should cancel the exit when reopened quickly', async () => {
    const { rerender } = setup();

    await rerender({ open: false });
    await rerender({ open: true });
    await vi.advanceTimersByTimeAsync(300);

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('should keep Tab inside the sheet when it has no controls', async () => {
    setup();
    const dialog = screen.getByRole('dialog');

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('should ignore other keys', async () => {
    const { onclose } = setup();

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });

    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('BottomSheet drag', () => {
  function setup() {
    const onclose = vi.fn();
    const { container } = render(BottomSheet, {
      open: true,
      onclose,
      label: 'Hoja',
      children: text('contenido'),
    });
    const handle = container.querySelector<HTMLElement>('.drag')!;
    const sheet = screen.getByRole('dialog');
    Object.defineProperty(sheet, 'offsetHeight', { value: 600 });
    return { onclose, handle, sheet };
  }

  const pointer = (type: string, clientY: number, timeStamp: number, extra = {}) => {
    const event = new Event(type, { bubbles: true }) as PointerEvent;
    Object.assign(event, { clientY, pointerId: 1, isPrimary: true, ...extra });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    return event;
  };

  it('should follow the finger and close past a third of its height', () => {
    const { onclose, handle, sheet } = setup();

    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointermove', 350, 5000));
    expect(sheet.style.transform).toBe('translateY(250px)');
    handle.dispatchEvent(pointer('pointerup', 350, 5000));

    expect(onclose).toHaveBeenCalledOnce();
    expect(sheet.style.transform).toBe('');
  });

  it('should close on a quick flick even when short', () => {
    const { onclose, handle } = setup();

    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointermove', 140, 100));
    handle.dispatchEvent(pointer('pointerup', 140, 100));

    expect(onclose).toHaveBeenCalledOnce();
  });

  it('should snap back after a slow short drag', () => {
    const { onclose, handle } = setup();

    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointermove', 140, 2000));
    handle.dispatchEvent(pointer('pointercancel', 140, 2000));

    expect(onclose).not.toHaveBeenCalled();
  });

  it('should resist dragging above the top', () => {
    const { handle, sheet } = setup();

    handle.dispatchEvent(pointer('pointerdown', 300, 0));
    handle.dispatchEvent(pointer('pointermove', 200, 100));

    expect(sheet.style.transform).toBe('translateY(-20px)');
  });

  it('should ignore other fingers and moves without a drag', () => {
    const { onclose, handle, sheet } = setup();

    handle.dispatchEvent(pointer('pointermove', 300, 0));
    handle.dispatchEvent(pointer('pointerup', 300, 0));
    handle.dispatchEvent(pointer('pointerdown', 100, 0));
    handle.dispatchEvent(pointer('pointerdown', 100, 0, { pointerId: 2 }));
    handle.dispatchEvent(pointer('pointermove', 500, 10, { pointerId: 2 }));
    handle.dispatchEvent(pointer('pointerup', 500, 10, { pointerId: 2 }));

    expect(sheet.style.transform).toBe('');
    expect(onclose).not.toHaveBeenCalled();
  });

  it('should not start a drag from a secondary pointer', () => {
    const { handle, sheet } = setup();

    handle.dispatchEvent(pointer('pointerdown', 100, 0, { isPrimary: false }));
    handle.dispatchEvent(pointer('pointermove', 400, 10));

    expect(sheet.style.transform).toBe('');
  });
});

describe('SaveSheet', () => {
  const base = {
    open: true,
    title: 'Crema de calabaza asada',
    ondone: () => {},
    onclose: () => {},
  };

  it('should confirm the save and offer to classify', async () => {
    const ondone = vi.fn();
    const onpriority = vi.fn();
    render(SaveSheet, {
      ...base,
      variant: 'saved',
      ondone,
      onpriority,
      categories: [{ id: 'c1', name: 'Recetas' }],
      category: 'c1',
      tags: ['otoño'],
    });

    expect(screen.getByRole('dialog', { name: 'Guardado: Crema de calabaza asada' })).toBeTruthy();
    expect(screen.getByText('Ya está en Stash. Si quieres, clasifícalo ahora.')).toBeTruthy();
    expect(screen.getByText('Si cierras sin tocar nada, se queda en Sin clasificar.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Prioridad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recetas' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('combobox', { name: 'Etiquetas' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Alta' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Listo' }));

    expect(onpriority).toHaveBeenCalledWith('high');
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('should keep Tab inside the sheet', async () => {
    render(SaveSheet, { ...base, variant: 'saved' });
    const buttons = screen.getAllByRole('button').filter((b) => b.tabIndex !== -1);
    const first = buttons[0]!;
    const last = screen.getByRole('button', { name: 'Listo' });
    const dialog = screen.getByRole('dialog');

    last.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('should only acknowledge when offline', async () => {
    const ondone = vi.fn();
    render(SaveSheet, { ...base, title: 'reddit.com/r/Madrid', variant: 'queued', ondone });

    expect(screen.getByRole('dialog', { name: 'En cola: reddit.com/r/Madrid' })).toBeTruthy();
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Prioridad' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Vale' }));
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('should say the link was already saved and offer to open or classify it', async () => {
    const onopen = vi.fn();
    const ondone = vi.fn();
    render(SaveSheet, { ...base, variant: 'saved', duplicate: true, onopen, ondone });

    expect(
      screen.getByRole('dialog', { name: 'Ya estaba guardado: Crema de calabaza asada' }),
    ).toBeTruthy();
    expect(screen.getByText('Lo guardaste antes. Puedes abrirlo o clasificarlo.')).toBeTruthy();
    expect(screen.queryByText(/Si cierras sin tocar nada/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Prioridad' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Listo' }));

    expect(onopen).toHaveBeenCalledOnce();
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('should say the link was already waiting offline', () => {
    render(SaveSheet, { ...base, variant: 'queued', duplicate: true });

    expect(
      screen.getByRole('dialog', { name: 'Ya estaba en cola: Crema de calabaza asada' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abrir' })).toBeNull();
  });

  it('should classify an existing item without the save confirmation', () => {
    render(SaveSheet, { ...base, variant: 'classify', priority: 'low' });

    expect(
      screen.getByRole('dialog', { name: 'Clasificar: Crema de calabaza asada' }),
    ).toBeTruthy();
    expect(screen.queryByText('Guardado')).toBeNull();
    expect(screen.queryByText(/Si cierras sin tocar nada/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Baja' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('InlineNotice', () => {
  it('should announce its title and text', () => {
    render(InlineNotice, {
      icon: 'link_off',
      title: 'X no ha dejado leer este post',
      children: text('Tienes la vista previa y el enlace.'),
    });

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('X no ha dejado leer este post');
    expect(notice.textContent).toContain('Tienes la vista previa y el enlace.');
  });
});
