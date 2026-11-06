import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import {
  AppHeader,
  GroupHeader,
  IconButton,
  ItemList,
  ItemRow,
  ScreenTitle,
  Thumbnail,
  UnsortedStrip,
  rowExit,
} from './index';

const rows = createRawSnippet(() => ({ render: () => '<li>fila</li>' }));

describe('ItemRow', () => {
  it('should open the reading view when the whole row is pressed', async () => {
    const onopen = vi.fn();
    render(ItemRow, {
      title: 'Cómo organizar la despensa',
      origin: 'Web, lacocinaordenada.es',
      category: 'Casa',
      onopen,
    });

    const row = screen.getByRole('button', { name: /Cómo organizar la despensa/ });
    expect(row.textContent).toContain('Web, lacocinaordenada.es · Casa');

    await fireEvent.click(row);

    expect(onopen).toHaveBeenCalledOnce();
  });

  it('should be a list item', () => {
    render(ItemRow, { title: 'T', origin: 'Web', onopen: () => {} });

    expect(screen.getByRole('listitem')).toBeTruthy();
  });

  it('should show the saved image when there is one', () => {
    const { container } = render(ItemRow, {
      title: 'T',
      origin: 'Web',
      thumbnail: { src: 'blob:thumb' },
      onopen: () => {},
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:thumb');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('should say a queued item is waiting for the network', () => {
    render(ItemRow, {
      title: 'reddit.com/r/Madrid',
      origin: 'Reddit',
      queued: true,
      onopen: () => {},
    });

    expect(screen.getByText(/En cola, se sube al volver la red/)).toBeTruthy();
    expect(screen.queryByText('Reddit')).toBeNull();
  });
});

describe('Thumbnail', () => {
  it('should paint the placeholder tone when there is no image', () => {
    const { container } = render(Thumbnail, { tone: 3, size: 56 });
    const box = container.querySelector<HTMLElement>('.th');

    expect(box?.style.background).toBe('var(--t3)');
    expect(box?.style.getPropertyValue('--size')).toBe('56px');
  });
});

describe('ItemList', () => {
  it('should render a named list', () => {
    render(ItemList, { children: rows, label: 'Alta' });

    expect(screen.getByRole('list', { name: 'Alta' })).toBeTruthy();
  });

  it('should drop the surface when bare', () => {
    render(ItemList, { children: rows, bare: true });

    expect(screen.getByRole('list').classList.contains('bare')).toBe(true);
  });
});

describe('GroupHeader', () => {
  it('should render the group name and count as a heading', () => {
    render(GroupHeader, { name: 'Alta', count: 2 });

    expect(screen.getByRole('heading', { level: 2, name: 'Alta 2' })).toBeTruthy();
  });

  it('should honour the heading level', () => {
    render(GroupHeader, { name: 'Baja', count: 1, level: 3 });

    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });
});

describe('UnsortedStrip', () => {
  it('should not render when nothing is unsorted', () => {
    const { container } = render(UnsortedStrip, { count: 0, onclassify: () => {}, children: rows });

    expect(container.querySelector('section')).toBeNull();
  });

  it('should show the count and open classification', async () => {
    const onclassify = vi.fn();
    render(UnsortedStrip, { count: 1, onclassify, children: rows });

    expect(screen.getByRole('region', { name: 'Sin clasificar (1)' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Clasificar' }));

    expect(onclassify).toHaveBeenCalledOnce();
  });

  it('should hide the Clasificar button offline', () => {
    render(UnsortedStrip, { count: 2, online: false, onclassify: () => {}, children: rows });

    expect(screen.queryByRole('button', { name: 'Clasificar' })).toBeNull();
    expect(screen.getByText('fila')).toBeTruthy();
  });
});

describe('AppHeader and ScreenTitle', () => {
  it('should open settings from the gear', async () => {
    const onsettings = vi.fn();
    render(AppHeader, { onsettings });

    await fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));

    expect(onsettings).toHaveBeenCalledOnce();
  });

  it('should render the screen title and its subtitle', () => {
    render(ScreenTitle, { title: 'Pendientes', subtitle: '6 por leer' });

    expect(screen.getByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
    expect(screen.getByText('6 por leer')).toBeTruthy();
  });

  it('should render the title alone', () => {
    const { container } = render(ScreenTitle, { title: 'Categorías' });

    expect(container.querySelector('p')).toBeNull();
  });

  it('should render an icon button with its accessible name', () => {
    render(IconButton, { icon: 'close', label: 'Cerrar' });

    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });
});

describe('rowExit', () => {
  const node = { offsetHeight: 72 } as HTMLElement;

  it('should fade first and then close the gap', () => {
    const config = rowExit(node, { reduced: false });

    expect(config.duration).toBe(360);
    expect(config.css?.(0.8, 0.2)).toMatch(/^opacity: 0\.5/);
    expect(config.css?.(0, 1)).toContain('height: 0px');
  });

  it('should only fade with reduced motion', () => {
    const config = rowExit(node, { reduced: true });

    expect(config.duration).toBe(150);
    expect(config.css?.(0.4, 0.6)).toBe('opacity: 0.4');
  });

  it('should follow the system preference by default', () => {
    expect(rowExit(node).duration).toBeGreaterThan(0);
  });
});
