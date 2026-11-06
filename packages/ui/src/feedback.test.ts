import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomBar, EmptyState, LoadingRows, SubpageBar, UndoToast, toastMotion } from './index';

describe('BottomBar', () => {
  it('should mark the active tab as the current page', () => {
    render(BottomBar, { active: 'search', onnavigate: () => {} });

    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    expect(nav.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Buscar' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('button', { name: 'Pendientes' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('should navigate to the pressed tab', async () => {
    const onnavigate = vi.fn();
    render(BottomBar, { active: 'pending', onnavigate });

    await fireEvent.click(screen.getByRole('button', { name: 'Categorías' }));

    expect(onnavigate).toHaveBeenCalledWith('categories');
  });
});

describe('SubpageBar', () => {
  it('should go back and show the title as the heading', async () => {
    const onback = vi.fn();
    render(SubpageBar, { title: 'Etiquetas', onback });

    expect(screen.getByRole('heading', { level: 1, name: 'Etiquetas' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(onback).toHaveBeenCalledOnce();
  });

  it('should open the original in a new tab without leaking the opener', () => {
    render(SubpageBar, {
      title: 'X',
      heading: false,
      onback: () => {},
      link: { label: 'Abrir en X', href: 'https://x.com/a/status/1' },
    });

    const link = screen.getByRole('link', { name: 'Abrir en X' });
    expect(link.getAttribute('href')).toBe('https://x.com/a/status/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('UndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const first = { id: 1, message: 'Marcado como leído' };

  it('should render an empty live region when there is no toast', () => {
    render(UndoToast, { toast: null, onundo: () => {}, onexpire: () => {} });

    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('should undo the action', async () => {
    const onundo = vi.fn();
    render(UndoToast, { toast: first, onundo, onexpire: () => {} });

    expect(screen.getByRole('status').textContent).toContain('Marcado como leído');
    await fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(onundo).toHaveBeenCalledWith(1);
  });

  it('should expire after five seconds', async () => {
    const onexpire = vi.fn();
    render(UndoToast, { toast: first, onundo: () => {}, onexpire });

    await vi.advanceTimersByTimeAsync(4999);
    expect(onexpire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onexpire).toHaveBeenCalledWith(1);
  });

  it('should restart the time when a new toast replaces the current one', async () => {
    const onexpire = vi.fn();
    const { rerender } = render(UndoToast, { toast: first, onundo: () => {}, onexpire });

    await vi.advanceTimersByTimeAsync(4000);
    await rerender({ toast: { id: 2, message: 'Descartado' } });
    await vi.advanceTimersByTimeAsync(4000);
    expect(onexpire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onexpire).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('should pause while it has focus', async () => {
    const onexpire = vi.fn();
    render(UndoToast, { toast: first, onundo: () => {}, onexpire });
    const undo = screen.getByRole('button', { name: 'Deshacer' });

    await vi.advanceTimersByTimeAsync(2000);
    await fireEvent.focusIn(undo);
    await vi.advanceTimersByTimeAsync(10000);
    expect(onexpire).not.toHaveBeenCalled();

    await fireEvent.focusOut(undo);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onexpire).toHaveBeenCalledOnce();
  });

  it('should pause while the page is hidden', async () => {
    const onexpire = vi.fn();
    render(UndoToast, { toast: first, onundo: () => {}, onexpire });
    const hidden = vi.spyOn(document, 'hidden', 'get');

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(onexpire).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(onexpire).toHaveBeenCalledOnce();
    hidden.mockRestore();
  });
});

describe('toastMotion', () => {
  const node = document.createElement('div');

  it('should slide from below', () => {
    const config = toastMotion(node, { reduced: false });

    expect(config.duration).toBe(200);
    expect(config.css?.(0, 1)).toBe('opacity: 0; transform: translateY(100%)');
  });

  it('should only fade with reduced motion', () => {
    expect(toastMotion(node, { reduced: true }).css?.(0.5, 0.5)).toBe('opacity: 0.5');
    expect(toastMotion(node).duration).toBeGreaterThan(0);
  });
});

describe('EmptyState', () => {
  it('should say how the list fills up', () => {
    render(EmptyState, { title: 'Lo tienes todo leído', text: 'Comparte un enlace a Stash.' });

    expect(screen.getByRole('heading', { name: 'Lo tienes todo leído' })).toBeTruthy();
    expect(screen.getByText('Comparte un enlace a Stash.')).toBeTruthy();
  });
});

describe('LoadingRows', () => {
  it('should announce loading and draw row-shaped blocks', () => {
    const { container } = render(LoadingRows, { groups: 1, rowsPerGroup: 3 });

    expect(screen.getByRole('status').textContent).toContain('Cargando');
    expect(container.querySelectorAll('.row')).toHaveLength(3);
  });

  it('should draw two groups of two by default', () => {
    const { container } = render(LoadingRows);

    expect(container.querySelectorAll('.row')).toHaveLength(4);
  });
});
