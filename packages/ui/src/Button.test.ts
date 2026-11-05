import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './index';

const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('Button', () => {
  it('should render its content as an accessible button', () => {
    render(Button, { children: label('Save') });

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('should not submit forms by default', () => {
    render(Button, { children: label('Save') });

    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('should call onclick when pressed', async () => {
    const onclick = vi.fn();
    render(Button, { children: label('Save'), onclick });

    await fireEvent.click(screen.getByRole('button'));

    expect(onclick).toHaveBeenCalledOnce();
  });
});
