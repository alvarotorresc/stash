import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';

describe('Reading', () => {
  it('should show an article with its classification and the original link', async () => {
    await renderApp('#/leer/item-despensa');

    expect(await screen.findByText(/Lo primero es sacar todo/)).toBeTruthy();
    expect(screen.getByText('lacocinaordenada.es · 6 min')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir original/ }).getAttribute('href')).toBe(
      'https://lacocinaordenada.es/organizar-la-despensa',
    );
    expect(screen.getByRole('button', { name: /Clasificar:.*Casa.*Alta.*despensa/ })).toBeTruthy();
  });

  it('should mark as read, go back and offer to undo', async () => {
    const { app } = await renderApp('#/');
    await fireEvent.click(screen.getByRole('button', { name: /organizar la despensa/ }));

    await fireEvent.click(await screen.findByRole('button', { name: 'Marcar leído' }));

    expect(await screen.findByText('Marcado como leído')).toBeTruthy();
    await waitFor(() => expect(app.router.route.name).toBe('pending'));
    expect(screen.queryByRole('button', { name: /organizar la despensa/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByRole('button', { name: /organizar la despensa/ })).toBeTruthy();
  });

  it('should discard with undo', async () => {
    const { app } = await renderApp('#/leer/item-abono');

    await fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    expect(await screen.findByText('Descartado')).toBeTruthy();
    expect(app.item('item-abono')?.status).toBe('discarded');
    app.expire(app.toast!.id);
    await waitFor(() => expect(screen.queryByText('Descartado')).toBeNull());
  });

  it('should show a tweet with the author initials and the X link', async () => {
    await renderApp('#/leer/item-vscode');

    expect(await screen.findByText('MG')).toBeTruthy();
    expect(screen.getByText('14 oct. 2026, 18:02')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir en X/ })).toBeTruthy();
  });

  it('should show a Reddit post without comments', async () => {
    await renderApp('#/leer/item-abono');

    expect(await screen.findByText('r/askspain · u/carmen_rv')).toBeTruthy();
    expect(screen.getByText(/Sin comentarios/)).toBeTruthy();
  });

  it('should show only the preview for Instagram', async () => {
    await renderApp('#/leer/item-calabaza');

    expect(await screen.findByText('@verduradetemporada en Instagram')).toBeTruthy();
    expect(
      screen.getByText('De Instagram, Stash guarda la vista previa y el enlace.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Abrir en Instagram/ })).toHaveLength(1);
  });

  it('should explain a blocked source above the preview', async () => {
    await renderApp('#/leer/item-extensiones');

    expect(await screen.findByText('X no ha dejado leer este post')).toBeTruthy();
    expect(screen.getByText('@martagil_dev en X')).toBeTruthy();
  });

  it('should show a queued link as waiting', async () => {
    await renderApp('#/leer/item-cola', { online: false });

    expect(await screen.findByText(/Está en cola/)).toBeTruthy();
    expect(screen.getByText(/lo puedes leer, pero marcar y clasificar esperan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marcar leído' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('should open the classify sheet from the classification row', async () => {
    const { app } = await renderApp('#/leer/item-despensa');

    await fireEvent.click(await screen.findByRole('button', { name: /Clasificar:/ }));
    const sheet = await screen.findByRole('dialog', { name: /Clasificar:/ });
    const input = within(sheet).getByRole('combobox');
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'ce' } });
    await within(sheet).findByRole('option', { name: /cena/ });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(app.item('item-despensa')?.tags).toEqual(['despensa', 'cena']));
    await fireEvent.click(within(sheet).getByRole('button', { name: /Quitar despensa/ }));
    await waitFor(() => expect(app.item('item-despensa')?.tags).toEqual(['cena']));
  });

  it('should say when the item no longer exists', async () => {
    await renderApp('#/leer/no-existe');

    expect(await screen.findByText('Este guardado ya no está')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Volver a Pendientes' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
  });
});
