import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';

describe('Search', () => {
  it('should find a word in the title and in the body, with a snippet', async () => {
    await renderApp('#/buscar');

    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'abono' } });

    expect(await screen.findByText('2 resultados en título y texto')).toBeTruthy();
    const results = screen.getByRole('list', { name: 'Resultados' });
    expect(results.querySelector('.s')?.textContent).toMatch(/el abono joven se mantiene/);
    expect(within(results).getAllByText('abono').length).toBeGreaterThan(0);
  });

  it('should filter by status, source, category and priority', async () => {
    await renderApp('#/buscar');
    await screen.findByText(/resultados/);

    await fireEvent.change(screen.getByRole('combobox', { name: 'Origen' }), {
      target: { value: 'reddit' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Prioridad' }), {
      target: { value: 'low' },
    });
    expect(await screen.findByText('1 resultado')).toBeTruthy();
    expect(screen.getByText(/Gran Vía en obras/)).toBeTruthy();

    await fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), {
      target: { value: 'read' },
    });
    expect(await screen.findByText('Nada coincide')).toBeTruthy();

    await fireEvent.change(screen.getByRole('combobox', { name: 'Origen' }), {
      target: { value: 'all' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Prioridad' }), {
      target: { value: 'all' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: 'cat-recetas' },
    });
    expect(await screen.findByText(/Pan de masa madre/)).toBeTruthy();

    await fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), {
      target: { value: 'all' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: 'none' },
    });
    await waitFor(() => expect(screen.getByText('2 resultados')).toBeTruthy());
  });

  it('should open a result', async () => {
    const { app } = await renderApp('#/buscar');

    await fireEvent.click(await screen.findByRole('button', { name: /organizar la despensa/ }));

    expect(app.router.route).toEqual({ name: 'item', id: 'item-despensa' });
  });
});
