import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test-utils';

const type = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('Sign in', () => {
  it('should start on the sign-in screen without a session', async () => {
    const { app } = await renderApp('#/', { signedIn: false });

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeTruthy();
    expect(app.router.route.name).toBe('login');
  });

  it('should ask for both fields and reject wrong credentials', async () => {
    await renderApp('#/entrar', { signedIn: false });

    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe tu email y tu contraseña.');

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'no-es-esta-123');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('El email o la contraseña no son correctos.')).toBeTruthy();
  });

  it('should enter and show the pending items', async () => {
    await renderApp('#/entrar', { signedIn: false });

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'calabaza-asada-2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
  });

  it('should not enter offline', async () => {
    await renderApp('#/entrar', { signedIn: false, online: false });

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'calabaza-asada-2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText(/Sin conexión/)).toBeTruthy();
  });
});

describe('Create account', () => {
  it('should measure the password and block very common ones', async () => {
    await renderApp('#/crear-cuenta', { signedIn: false });

    await type('Email', 'nuevo@ejemplo.com');
    await type('Contraseña', 'password123');
    expect(screen.getByText('Muy común: elige otra')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('alert').textContent).toMatch(/al menos 10 caracteres/);

    await type('Contraseña', 'corta');
    expect(screen.getByText('Mínimo 10 caracteres')).toBeTruthy();
  });

  it('should validate the email and reject one that already has an account', async () => {
    await renderApp('#/crear-cuenta', { signedIn: false });

    await type('Email', 'sin-arroba');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe un email válido.');

    await type('Email', 'maria@ejemplo.com');
    await type('Contraseña', 'una frase bastante larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText(/Ese email ya tiene cuenta/)).toBeTruthy();
  });

  it('should show the recovery code once and continue only after confirming', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:code'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { app } = await renderApp('#/crear-cuenta', { signedIn: false });

    await type('Email', 'nuevo@ejemplo.com');
    await type('Contraseña', 'una frase bastante larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu código de recuperación' }),
    ).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(app.recoveryCode));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(click).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(app.recoveryCode).not.toBeNull();
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
    click.mockRestore();
  });

  it('should keep the copy button as it was when the clipboard fails', async () => {
    Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    const { app } = await renderApp('#/crear-cuenta', { signedIn: false });
    await type('Email', 'otra@ejemplo.com');
    await type('Contraseña', 'una frase bastante larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu código de recuperación' });

    await fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(app.recoveryCode).toHaveLength(28);
    expect(screen.queryByRole('button', { name: 'Copiado' })).toBeNull();
  });
});

describe('Recover', () => {
  it('should change the password with the recovery code and show the new code', async () => {
    const { app } = await renderApp('#/entrar', { signedIn: false });
    await fireEvent.click(screen.getByRole('link', { name: 'He olvidado la contraseña' }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await screen.findByRole('heading', { level: 1, name: 'Recuperar con tu código' });

    await fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert').textContent).toMatch(/código de recuperación/);

    await type('Email', 'maria@ejemplo.com');
    await type('Código de recuperación', 'AAAA BBBB');
    await type('Contraseña nueva', 'corta');
    await fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert').textContent).toMatch(/al menos 10 caracteres/);

    await type('Contraseña nueva', 'una contraseña nueva larga');
    await fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText(/el código de recuperación no son correctos/)).toBeTruthy();

    await type('Código de recuperación', 'k7qf 2m9x wd4r 8htn c3pv 6yjb q5la');
    await fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    // The old code no longer works: the new one is shown once before going on.
    await screen.findByRole('heading', { level: 1, name: 'Tu código de recuperación' });
    expect(app.recoveryCode).toHaveLength(28);
    expect(app.recoveryCode).not.toBe('K7QF2M9XWD4R8HTNC3PV6YJBQ5LA');
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
  });

  it('should go back to sign in', async () => {
    const { app } = await renderApp('#/recuperar', { signedIn: false });

    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(app.router.route.name).toBe('login');
  });
});
