import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createMockPopupService, type MockPopupOptions } from '../../lib/mock';
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

  it('should create the account in the popup and show the recovery code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPopup({ signedIn: false });
    await fireEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'password123');
    expect(screen.getByText('Muy común: elige otra')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('alert').textContent).toMatch(/al menos 10 caracteres/);

    await type('Contraseña', 'una frase bastante larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText(/Ese email ya tiene cuenta/)).toBeTruthy();

    await type('Email', 'nuevo@ejemplo.com');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    const heading = await screen.findByRole('heading', { name: 'Tu código de recuperación' });
    const screenEl = heading.closest('section') as HTMLElement;
    await fireEvent.click(within(screenEl).getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    await fireEvent.click(within(screenEl).getByRole('button', { name: 'Descargar' }));
    expect(click).toHaveBeenCalledOnce();
    await fireEvent.click(within(screenEl).getByRole('checkbox'));
    await fireEvent.click(within(screenEl).getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Guardado')).toBeTruthy();
    click.mockRestore();
  });

  it('should go back from creating an account to signing in', async () => {
    renderPopup({ signedIn: false });
    await fireEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(screen.getByText('Entra para guardar páginas en tu Stash.')).toBeTruthy();
  });

  it('should keep Copiar when the clipboard fails', async () => {
    Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    renderPopup({ signedIn: false });
    await fireEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    await type('Email', 'otra@ejemplo.com');
    await type('Contraseña', 'una frase bastante larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Tu código de recuperación' });

    await fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(screen.queryByRole('button', { name: 'Copiado' })).toBeNull();
  });
});
