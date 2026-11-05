import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './index';
import { text } from './test-utils';

describe('Button', () => {
  it('should render its content as an accessible button', () => {
    render(Button, { children: text('Listo') });

    expect(screen.getByRole('button', { name: 'Listo' })).toBeTruthy();
  });

  it('should not submit forms by default', () => {
    render(Button, { children: text('Listo') });

    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('should call onclick when pressed', async () => {
    const onclick = vi.fn();
    render(Button, { children: text('Listo'), onclick });

    await fireEvent.click(screen.getByRole('button'));

    expect(onclick).toHaveBeenCalledOnce();
  });

  it('should apply the variant class', () => {
    render(Button, { children: text('Borrar'), variant: 'danger' });

    expect(screen.getByRole('button').classList.contains('danger')).toBe(true);
  });

  it('should stay focusable but ignore presses when unavailable', async () => {
    const onclick = vi.fn();
    render(Button, { children: text('Marcar leído'), unavailable: true, onclick });
    const button = screen.getByRole('button', { name: 'Marcar leído' });

    await fireEvent.click(button);

    expect(onclick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('should render a decorative icon and fill the width when asked', () => {
    const { container } = render(Button, {
      children: text('Copiar'),
      icon: 'content_copy',
      block: true,
    });

    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByRole('button').classList.contains('block')).toBe(true);
  });
});
