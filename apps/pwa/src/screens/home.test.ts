import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';

describe('Home', () => {
  it('should list pending items by priority with the unsorted strip first', async () => {
    await renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
    const strip = screen.getByRole('region', { name: /Sin clasificar \(2\)/ });
    expect(within(strip).getByText(/Vía Verde del Aceite/)).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.join('|')).toMatch(/Alta.*\|.*Media.*\|.*Baja/);
    expect(screen.getByText('9 por leer')).toBeTruthy();
  });

  it('should put higher categories first inside a priority', async () => {
    await renderApp();

    const media = screen.getByRole('list', { name: 'Media' });
    const titles = within(media)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    // Trabajo, Recetas, Madrid: the order of the categories.
    expect(titles[0]).toMatch(/VS Code/);
    expect(titles[1]).toMatch(/calabaza/);
    expect(titles[2]).toMatch(/Madrid para 2027/);
  });

  it('should open the classify sheet with the first unsorted item', async () => {
    const { app } = await renderApp();

    await fireEvent.click(screen.getByRole('button', { name: 'Clasificar' }));

    const sheet = await screen.findByRole('dialog', { name: /Clasificar: Vía Verde/ });
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Alta' }));
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Casa' }));
    await waitFor(() => expect(app.item('item-via-verde')?.categoryId).toBe('cat-casa'));
    expect(app.item('item-via-verde')?.priority).toBe('high');
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Listo' }));
    expect(app.sheet).toBeNull();
  });

  it('should open the reading view from a row', async () => {
    const { app } = await renderApp();

    await fireEvent.click(screen.getByRole('button', { name: /organizar la despensa/ }));

    expect(app.router.route).toEqual({ name: 'item', id: 'item-despensa' });
    expect(await screen.findByRole('button', { name: 'Marcar leído' })).toBeTruthy();
  });

  it('should go to Settings from the gear', async () => {
    await renderApp();

    await fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeTruthy();
  });

  it('should say how to fill it when nothing is pending', async () => {
    const { service } = await renderApp();
    const items = await service.listItems();
    for (const item of items) await service.setStatus(item.id, 'read');

    expect(await screen.findByText('Lo tienes todo leído')).toBeTruthy();
    expect(screen.getByText('Nada por leer')).toBeTruthy();
  });

  it('should show the offline notice, the queue and no Clasificar button', async () => {
    await renderApp('#/', { online: false });

    expect(screen.getByText('Sin conexión')).toBeTruthy();
    expect(screen.getByText(/En cola, se sube al volver la red/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clasificar' })).toBeNull();
  });

  it('should show loading blocks until the first answer', async () => {
    const { container } = await renderApp('#/', { latency: 30 }, { waitForData: false });

    expect(screen.getByText('Cargando…')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"], .loading, .rows')).toBeTruthy();
    expect(await screen.findByText('9 por leer')).toBeTruthy();
  });

  it('should offer to retry when the data cannot be loaded', async () => {
    const { app, service } = await renderApp();
    const original = service.listItems;
    service.listItems = () => Promise.reject(new Error('down'));
    await app.refresh();

    expect(await screen.findByText('No se han podido cargar tus guardados')).toBeTruthy();
    service.listItems = original;
    await fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.queryByText('No se han podido cargar tus guardados')).toBeNull(),
    );
  });

  it('should switch tabs from the bottom bar', async () => {
    await renderApp();

    await fireEvent.click(screen.getByRole('button', { name: 'Categorías' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Categorías' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('searchbox')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
  });
});

describe('Home tabs', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('should show the three tabs with Pendientes selected', async () => {
    await renderApp();

    expect(screen.getByRole('tablist', { name: 'Estado' })).toBeTruthy();
    expect(tab('Pendientes').getAttribute('aria-selected')).toBe('true');
    expect(tab('Leídos').getAttribute('aria-selected')).toBe('false');
    expect(tab('Descartados').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });

  it('should list read items under Leídos and hide pending ones', async () => {
    await renderApp();

    await fireEvent.click(tab('Leídos'));

    expect(screen.getByRole('heading', { level: 1, name: 'Leídos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pan de masa madre/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /organizar la despensa/ })).toBeNull();
  });

  it('should list discarded items under Descartados', async () => {
    const { service } = await renderApp();
    await service.setStatus('item-abono', 'discarded');

    await fireEvent.click(tab('Descartados'));

    expect(await screen.findByRole('button', { name: /abono transporte/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pan de masa madre/ })).toBeNull();
  });

  it('should order read items from the newest saved to the oldest', async () => {
    const { service } = await renderApp();
    await service.setStatus('item-despensa', 'read'); // saved 20h ago
    await service.setStatus('item-calabaza', 'read'); // saved 4h ago

    await fireEvent.click(tab('Leídos'));

    const titles = (await screen.findAllByRole('button', { name: /Pan|despensa|calabaza/ })).map(
      (button) => button.textContent ?? '',
    );
    expect(titles[0]).toMatch(/calabaza/);
    expect(titles[1]).toMatch(/despensa/);
    expect(titles[2]).toMatch(/Pan de masa madre/);
  });

  it('should keep the header count about pending items on every tab', async () => {
    await renderApp();

    await fireEvent.click(tab('Leídos'));

    expect(screen.getByText('9 por leer')).toBeTruthy();
  });

  it('should say nothing was discarded when Descartados is empty', async () => {
    await renderApp();

    await fireEvent.click(tab('Descartados'));

    expect(screen.getByText('No has descartado nada')).toBeTruthy();
  });

  it('should say nothing was read when Leídos is empty', async () => {
    const { service } = await renderApp();
    await service.setStatus('item-pan', 'pending');

    await fireEvent.click(tab('Leídos'));

    expect(await screen.findByText('Aún no has leído nada')).toBeTruthy();
  });

  it('should switch tabs with the arrow keys', async () => {
    await renderApp();

    await fireEvent.keyDown(tab('Pendientes'), { key: 'ArrowRight' });

    expect(tab('Leídos').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Leídos'));
  });

  it('should remember the tab when coming back from an item', async () => {
    const { app } = await renderApp();
    await fireEvent.click(tab('Leídos'));

    await fireEvent.click(screen.getByRole('button', { name: /Pan de masa madre/ }));
    await screen.findByRole('button', { name: 'Volver a pendientes' });
    app.router.back();

    expect(await screen.findByRole('tab', { name: 'Leídos' })).toBeTruthy();
    expect(tab('Leídos').getAttribute('aria-selected')).toBe('true');
  });

  it('should send a read item back to pending with undo', async () => {
    const { app } = await renderApp();
    await fireEvent.click(tab('Leídos'));
    await fireEvent.click(screen.getByRole('button', { name: /Pan de masa madre/ }));

    await fireEvent.click(await screen.findByRole('button', { name: 'Volver a pendientes' }));

    await waitFor(() => expect(app.item('item-pan')?.status).toBe('pending'));
    expect(await screen.findByText('Vuelto a pendientes')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(app.item('item-pan')?.status).toBe('read'));
  });

  it('should offer to mark read a discarded item', async () => {
    const { app, service } = await renderApp();
    await service.setStatus('item-abono', 'discarded');
    await fireEvent.click(tab('Descartados'));
    await fireEvent.click(await screen.findByRole('button', { name: /abono transporte/ }));

    expect(await screen.findByRole('button', { name: 'Volver a pendientes' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Marcar leído' }));

    await waitFor(() => expect(app.item('item-abono')?.status).toBe('read'));
  });
});
