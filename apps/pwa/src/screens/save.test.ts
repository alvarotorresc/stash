import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';

const shareAt = (url: string) => `?share=${encodeURIComponent(url)}#/`;

describe('Save sheet from the share target', () => {
  it('should save the shared link and offer to classify it', async () => {
    const { app } = await renderApp(shareAt('https://www.reddit.com/r/Madrid/comments/9xyz/belen'));

    const sheet = await screen.findByRole('dialog', { name: /Guardado:/ });
    expect(
      within(sheet).getByText('Ya está en Stash. Si quieres, clasifícalo ahora.'),
    ).toBeTruthy();
    expect(location.search).toBe('');
    const saved = app.items.find((item) => item.url.includes('9xyz'));
    expect(saved?.origin).toBe('r/Madrid');
    expect(saved?.source).toBe('reddit');
  });

  it('should say a shared link was already saved and take to the existing item', async () => {
    const url = 'https://lacocinaordenada.es/organizar-la-despensa';
    const { app } = await renderApp(shareAt(url));
    const before = app.items.length;

    const sheet = await screen.findByRole('dialog', { name: /Ya estaba guardado:/ });
    expect(within(sheet).getByText('Ya estaba guardado')).toBeTruthy();
    expect(
      within(sheet).getByText('Lo guardaste antes. Puedes abrirlo o clasificarlo.'),
    ).toBeTruthy();
    expect(within(sheet).getByRole('group', { name: 'Prioridad' })).toBeTruthy();
    expect(app.items).toHaveLength(before);

    await fireEvent.click(within(sheet).getByRole('button', { name: 'Abrir' }));

    await waitFor(() => expect(app.sheet).toBeNull());
    expect(app.router.route).toEqual({ name: 'item', id: 'item-despensa' });
  });

  it('should not show the already-saved notice for a new link', async () => {
    await renderApp(shareAt('https://example.com/nuevo'));

    await screen.findByRole('dialog', { name: /Guardado:/ });
    expect(screen.queryByText('Ya estaba guardado')).toBeNull();
  });

  it('should leave it unsorted when closed without touching anything', async () => {
    const { app } = await renderApp(shareAt('https://example.com/articulo'));
    const sheet = await screen.findByRole('dialog', { name: /Guardado:/ });

    await fireEvent.keyDown(sheet, { key: 'Escape' });

    await waitFor(() => expect(app.sheet).toBeNull());
    const saved = app.items.find((item) => item.url === 'https://example.com/articulo');
    expect(saved?.priority).toBeNull();
    expect(screen.getByRole('region', { name: /Sin clasificar \(3\)/ })).toBeTruthy();
  });

  it('should create a category from the sheet', async () => {
    const { app } = await renderApp(shareAt('https://x.com/alguien/status/42'));
    const sheet = await screen.findByRole('dialog', { name: /Guardado:/ });

    await fireEvent.click(within(sheet).getByRole('button', { name: /Nueva/ }));
    const field = within(sheet).getByRole('textbox', { name: 'Nombre de la categoría nueva' });
    await fireEvent.input(field, { target: { value: 'Lecturas' } });
    await fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => {
      const saved = app.items.find((item) => item.url.includes('/status/42'));
      expect(app.categoryName(saved?.categoryId ?? null)).toBe('Lecturas');
    });
  });

  it('should queue the link offline and say so', async () => {
    const { app } = await renderApp(shareAt('https://example.com/sin-red'), { online: false });

    const sheet = await screen.findByRole('dialog', { name: /En cola:/ });
    expect(within(sheet).getByText('Sin conexión')).toBeTruthy();
    expect(within(sheet).queryByRole('group', { name: 'Prioridad' })).toBeNull();
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Vale' }));
    expect(app.sheet).toBeNull();
  });

  it('should ignore a shared value that is not a web link', async () => {
    const { app } = await renderApp('?share=javascript%3Aalert(1)#/');

    expect(app.sheet).toBeNull();
    expect(location.search).toBe('');
  });

  it('should keep a link shared while signed out and save it after entering', async () => {
    const { app } = await renderApp(shareAt('https://example.com/despues'), { signedIn: false });

    expect(app.pendingShare).toBe('https://example.com/despues');
    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'maria@ejemplo.com' },
    });
    await fireEvent.input(screen.getByLabelText('Contraseña'), {
      target: { value: 'calabaza-asada-2026' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('dialog', { name: /Guardado:/ })).toBeTruthy();
  });

  it('should close the sheet with the system Back', async () => {
    const { app } = await renderApp(shareAt('https://example.com/atras'));
    await screen.findByRole('dialog', { name: /Guardado:/ });

    history.back();

    await waitFor(() => expect(app.sheet).toBeNull());
  });
});
