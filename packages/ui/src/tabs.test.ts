import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedTabs } from './index';

const tabs = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'read', label: 'Leídos' },
  { id: 'discarded', label: 'Descartados' },
];

function setup(value = 'pending') {
  const onchange = vi.fn();
  render(SegmentedTabs, { label: 'Estado', tabs, value, idBase: 'x', onchange });
  return onchange;
}

describe('SegmentedTabs', () => {
  it('should expose a tablist with the active tab selected', () => {
    setup('read');

    expect(screen.getByRole('tablist', { name: 'Estado' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Leídos' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Pendientes' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('should only let the active tab take focus with Tab', () => {
    setup('read');

    expect(screen.getByRole('tab', { name: 'Leídos' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Pendientes' }).tabIndex).toBe(-1);
  });

  it('should point each tab at its panel', () => {
    setup();

    expect(screen.getByRole('tab', { name: 'Leídos' }).getAttribute('aria-controls')).toBe(
      'x-panel',
    );
    expect(screen.getByRole('tab', { name: 'Leídos' }).id).toBe('x-tab-read');
  });

  it('should change on click', async () => {
    const onchange = setup();

    await fireEvent.click(screen.getByRole('tab', { name: 'Descartados' }));

    expect(onchange).toHaveBeenCalledWith('discarded');
  });

  it('should move with the arrow keys, wrapping at the ends', async () => {
    const onchange = setup();
    const first = screen.getByRole('tab', { name: 'Pendientes' });

    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onchange).toHaveBeenLastCalledWith('read');
    await fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onchange).toHaveBeenLastCalledWith('discarded');
    await fireEvent.keyDown(first, { key: 'End' });
    expect(onchange).toHaveBeenLastCalledWith('discarded');
    await fireEvent.keyDown(first, { key: 'Home' });
    expect(onchange).toHaveBeenLastCalledWith('pending');
  });

  it('should ignore other keys', async () => {
    const onchange = setup();

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Pendientes' }), { key: 'a' });

    expect(onchange).not.toHaveBeenCalled();
  });
});
