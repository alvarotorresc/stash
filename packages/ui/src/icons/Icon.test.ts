import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { Icon, icons } from '../index';

describe('Icon', () => {
  it('should be hidden from assistive technology when it has no label', () => {
    const { container } = render(Icon, { name: 'search' });

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('should expose an image role when labelled', () => {
    render(Icon, { name: 'search', label: 'Buscar' });

    expect(screen.getByRole('img', { name: 'Buscar' })).toBeTruthy();
  });

  it('should draw the filled path when filled', () => {
    const { container } = render(Icon, { name: 'inbox', filled: true, size: 18 });

    const svg = container.querySelector('svg');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(icons.inbox.fill);
    expect(svg?.getAttribute('width')).toBe('18');
  });

  it('should draw the outline path by default', () => {
    const { container } = render(Icon, { name: 'inbox' });

    expect(container.querySelector('path')?.getAttribute('d')).toBe(icons.inbox.outline);
  });
});
