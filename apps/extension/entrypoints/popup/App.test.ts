import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createMockPopupService, EXAMPLE_TAB, type MockPopupOptions } from '../../lib/mock';
import { AccountError } from '../../lib/service';
import App from './App.svelte';

function renderPopup(options: MockPopupOptions = {}) {
  const service = createMockPopupService(options);
  const onclose = vi.fn();
  render(App, { service, onclose });
  return { service, onclose };
}

const type = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('Popup', () => {
  it('should save the open tab right away and offer to classify it', async () => {
    const { service } = renderPopup();

    expect(await screen.findByText('Guardado')).toBeTruthy();
    expect(screen.getByText('Cómo organizar la despensa para no tirar comida')).toBeTruthy();
    expect(screen.getByText('lacocinaordenada.es')).toBeTruthy();
    const classify = vi.spyOn(service, 'classify');

    await fireEvent.click(screen.getByRole('button', { name: 'Alta' }));
    await fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-casa' } });
    const tags = screen.getByRole('combobox', { name: 'Etiquetas' });
    await fireEvent.focus(tags);
    await fireEvent.input(tags, { target: { value: 'or' } });
    expect(await screen.findByRole('option', { name: /orden/ })).toBeTruthy();
    await fireEvent.keyDown(tags, { key: 'Enter' });

    expect(classify).toHaveBeenCalledWith('item-1', { priority: 'high' });
    expect(classify).toHaveBeenCalledWith('item-1', { categoryId: 'cat-casa' });
    expect(classify).toHaveBeenCalledWith('item-1', { tags: ['orden'] });
    await fireEvent.click(screen.getByRole('button', { name: /Quitar orden/ }));
    expect(classify).toHaveBeenLastCalledWith('item-1', { tags: [] });
    await fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: '' } });
    expect(classify).toHaveBeenLastCalledWith('item-1', { categoryId: null });
  });

  it('should open Stash and close with Listo, the close button or Escape', async () => {
    const { onclose } = renderPopup();
    await screen.findByText('Guardado');

    expect(screen.getByRole('link', { name: 'Abrir Stash' }).getAttribute('href')).toBe(
      'https://stash.alvarotc.com',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(3);
  });

  it('should hand the HTML and meta tags read from the tab to the service', async () => {
    const tab = {
      url: 'https://example.com/a',
      title: 'Artículo',
      html: '<html><body><p>Hola</p></body></html>',
      meta: [{ key: 'description', content: 'Resumen' }],
    };
    const service = createMockPopupService({ tab });
    const save = vi.spyOn(service, 'save');
    render(App, { service, onclose: () => {} });

    expect(await screen.findByText('Guardado')).toBeTruthy();
    expect(save).toHaveBeenCalledWith(tab);
  });

  it('should show the tab while saving', async () => {
    renderPopup({ latency: 20 });

    expect(await screen.findByText('Guardando…')).toBeTruthy();
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('should offer to retry when saving fails', async () => {
    const service = createMockPopupService();
    const save = service.save;
    service.save = () => Promise.reject(new Error('down'));
    render(App, { service, onclose: () => {} });

    expect(await screen.findByText('No se ha podido guardar')).toBeTruthy();
    service.save = save;
    await fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('should explain that pages that are not web pages cannot be saved', async () => {
    renderPopup({ tab: { url: 'chrome://extensions', title: 'Extensiones' } });

    expect(await screen.findByText('Esta página no se puede guardar')).toBeTruthy();
  });

  it('should treat a window without a tab the same way', async () => {
    renderPopup({ tab: null });

    expect(await screen.findByText('Esta página no se puede guardar')).toBeTruthy();
  });
});

describe('Popup without a session', () => {
  it('should sign in inside the popup and then save the tab', async () => {
    renderPopup({ signedIn: false });
    expect(await screen.findByText('Entra para guardar páginas en tu Stash.')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe tu email y tu contraseña.');

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'no-es-esta-123');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('El email o la contraseña no son correctos.')).toBeTruthy();

    await type('Contraseña', 'calabaza-asada-2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('should send people without an account to the web app to create one', async () => {
    renderPopup({ signedIn: false });

    const link = await screen.findByRole('link', { name: 'Créala en la web de Stash' });

    expect({ href: link.getAttribute('href'), rel: link.getAttribute('rel') }).toEqual({
      href: 'https://stash.alvarotc.com',
      rel: 'noopener noreferrer',
    });
  });

  it.each([
    ['rate-limited', 'Demasiados intentos'],
    ['offline', 'Sin conexión'],
    ['no-access', 'necesita permiso'],
  ] as const)('should explain a %s failure on sign in', async (code, text) => {
    const service = createMockPopupService({ signedIn: false });
    service.login = () => Promise.reject(new AccountError(code));
    render(App, { service, onclose: () => {} });
    await screen.findByLabelText('Email');
    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'calabaza-asada-2026');

    await fireEvent.click(await screen.findByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });

  it('should say something went wrong on an unexpected failure', async () => {
    const service = createMockPopupService({ signedIn: false });
    service.login = () => Promise.reject(new Error('boom'));
    render(App, { service, onclose: () => {} });
    await screen.findByLabelText('Email');
    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'calabaza-asada-2026');

    await fireEvent.click(await screen.findByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Algo ha fallado');
  });

  it('should fill in the email of the last session', async () => {
    const service = createMockPopupService({ signedIn: false });
    service.lastEmail = () => 'maria@ejemplo.com';
    render(App, { service, onclose: () => {} });

    expect(((await screen.findByLabelText('Email')) as HTMLInputElement).value).toBe(
      'maria@ejemplo.com',
    );
  });
});

describe('Popup saved links', () => {
  it('should say that the link was already saved', async () => {
    const service = createMockPopupService();
    await service.save({ url: EXAMPLE_TAB.url, title: EXAMPLE_TAB.title });
    render(App, { service, onclose: () => {} });

    expect(await screen.findByText('Ya estaba guardado')).toBeTruthy();
  });

  it('should save the links waiting from the menu once unlocked, then the tab', async () => {
    const service = createMockPopupService({ pendingLinks: ['https://a.example/'] });
    const savePending = vi.spyOn(service, 'savePendingLinks');
    render(App, { service, onclose: () => {} });

    expect(await screen.findByText('Guardado')).toBeTruthy();
    expect(savePending).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Ver mi lista' }));
    expect(await screen.findByText('a.example')).toBeTruthy();
  });

  it('should still save the tab when the waiting links fail', async () => {
    const service = createMockPopupService();
    service.savePendingLinks = () => Promise.reject(new Error('down'));
    render(App, { service, onclose: () => {} });

    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('should open the list, read an item and go back', async () => {
    renderPopup();
    await screen.findByText('Guardado');

    await fireEvent.click(screen.getByRole('button', { name: 'Ver mi lista' }));
    expect(await screen.findByRole('heading', { name: 'Pendientes' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Cómo organizar la despensa/ }));

    expect(await screen.findByText('Texto de ejemplo del artículo.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Abrir original/ })[0]?.getAttribute('href')).toBe(
      EXAMPLE_TAB.url,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByRole('heading', { name: 'Pendientes' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('should say when there is nothing pending', async () => {
    renderPopup({ tab: { url: 'chrome://extensions', title: 'Extensiones' } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Ver mi lista' }));

    expect(await screen.findByText('No tienes nada pendiente')).toBeTruthy();
  });

  it('should offer to retry when the list does not load', async () => {
    const service = createMockPopupService({ tab: null });
    const list = service.listItems;
    service.listItems = () => Promise.reject(new Error('down'));
    render(App, { service, onclose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: 'Ver mi lista' }));
    expect(await screen.findByText('No se ha podido cargar la lista')).toBeTruthy();

    service.listItems = list;
    await fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('No tienes nada pendiente')).toBeTruthy();
  });

  it('should say when an item is gone, and when it fails to load', async () => {
    const service = createMockPopupService();
    await service.save({ url: 'https://a.example/', title: 'A' });
    service.getItem = () => Promise.resolve(null);
    render(App, { service, onclose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: 'Ver mi lista' }));
    await fireEvent.click(await screen.findByRole('button', { name: /a\.example/ }));
    expect(await screen.findByText('Este guardado ya no está')).toBeTruthy();

    service.getItem = () => Promise.reject(new Error('down'));
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    await fireEvent.click(await screen.findByRole('button', { name: /a\.example/ }));
    expect(await screen.findByText('Este guardado ya no está')).toBeTruthy();
  });

  it('should show a preview when the page could not be read', async () => {
    const service = createMockPopupService();
    await service.save({ url: 'https://a.example/', title: 'A' });
    const item = await service.getItem('item-1');
    service.getItem = () =>
      Promise.resolve(
        item && { ...item, content: { kind: 'preview', description: 'Solo la vista previa' } },
      );
    render(App, { service, onclose: () => {} });
    await fireEvent.click(await screen.findByRole('button', { name: 'Ver mi lista' }));
    await fireEvent.click(await screen.findByRole('button', { name: /a\.example/ }));

    expect(await screen.findByText('Solo la vista previa')).toBeTruthy();
  });
});

describe('Popup log out', () => {
  it('should log out and go back to the login', async () => {
    const { service } = renderPopup();
    await screen.findByText('Guardado');
    const logout = vi.spyOn(service, 'logout');

    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('Entra para guardar páginas en tu Stash.')).toBeTruthy();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('should go to the login even when closing the session fails', async () => {
    const service = createMockPopupService();
    service.logout = () => Promise.reject(new Error('gone'));
    render(App, { service, onclose: () => {} });
    await screen.findByText('Guardado');

    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('Entra para guardar páginas en tu Stash.')).toBeTruthy();
  });
});
