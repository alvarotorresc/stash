import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test-utils';

describe('Settings', () => {
  it('should show the account and how long the device remembers it', async () => {
    await renderApp('#/ajustes');

    expect(screen.getByText('maria@ejemplo.com')).toBeTruthy();
    expect(screen.getByText(/te recuerda hasta el 5 dic/)).toBeTruthy();
  });

  it('should open categories and tags', async () => {
    const { app } = await renderApp('#/ajustes');

    await fireEvent.click(screen.getByRole('button', { name: /Etiquetas/ }));
    expect(app.router.route.name).toBe('tags');
    await fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));
    await fireEvent.click(await screen.findByRole('button', { name: /Categorías 5/ }));
    expect(app.router.route.name).toBe('categories');
  });

  it('should export everything as a file', async () => {
    const createObjectURL = vi.fn(() => 'blob:stash');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderApp('#/ajustes');

    await fireEvent.click(screen.getByRole('button', { name: /Exportar todo/ }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('should say when the export fails', async () => {
    const { service } = await renderApp('#/ajustes');
    service.exportAll = () => Promise.reject(new Error('no'));

    await fireEvent.click(screen.getByRole('button', { name: /Exportar todo/ }));

    expect(await screen.findByText(/No se ha podido preparar el archivo/)).toBeTruthy();
  });

  it('should sign out to the sign-in screen with the email filled in', async () => {
    const { app } = await renderApp('#/ajustes');

    await fireEvent.click(screen.getByRole('button', { name: /Cerrar sesión/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeTruthy();
    expect(app.session).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('maria@ejemplo.com');
  });

  it('should ask for the password before deleting the account', async () => {
    const { app } = await renderApp('#/ajustes');

    await fireEvent.click(screen.getByRole('button', { name: /Borrar cuenta/ }));
    const dialog = screen.getByRole('dialog', { name: 'Borrar la cuenta' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar cuenta' }));
    expect(within(dialog).getByText('Escribe tu contraseña para confirmar.')).toBeTruthy();

    await fireEvent.input(within(dialog).getByLabelText('Contraseña'), {
      target: { value: 'otra-cosa-123' },
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar cuenta' }));
    expect(await within(dialog).findByText('La contraseña no es correcta.')).toBeTruthy();

    await fireEvent.input(within(dialog).getByLabelText('Contraseña'), {
      target: { value: 'calabaza-asada-2026' },
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar cuenta' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Crea tu cuenta' })).toBeTruthy();
    expect(app.session).toBeNull();
  });

  it('should cancel deleting the account', async () => {
    await renderApp('#/ajustes');

    await fireEvent.click(screen.getByRole('button', { name: /Borrar cuenta/ }));
    const dialog = screen.getByRole('dialog', { name: 'Borrar la cuenta' }) as HTMLDialogElement;
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(dialog.open).toBe(false);
  });

  it('should not delete the account offline', async () => {
    await renderApp('#/ajustes', { online: false });

    await fireEvent.click(screen.getByRole('button', { name: /Borrar cuenta/ }));
    const dialog = screen.getByRole('dialog', { name: 'Borrar la cuenta' });
    await fireEvent.input(within(dialog).getByLabelText('Contraseña'), {
      target: { value: 'calabaza-asada-2026' },
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar cuenta' }));

    expect(await within(dialog).findByText(/Comprueba la conexión/)).toBeTruthy();
  });
});
