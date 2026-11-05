import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, PasswordField, TextField } from './index';

describe('TextField', () => {
  it('should label the input with a visible label', () => {
    render(TextField, { label: 'Email', type: 'email', autocomplete: 'username' });

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('username');
  });

  it('should describe the input with its help line', () => {
    render(TextField, { label: 'Buscar', help: 'En título y texto', enterkeyhint: 'search' });

    const input = screen.getByLabelText('Buscar');
    const note = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('En título y texto');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('should mark the input invalid and show the error instead of the help', () => {
    render(TextField, { label: 'Email', help: 'Ayuda', error: 'Falta el email' });

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Falta el email')).toBeTruthy();
    expect(screen.queryByText('Ayuda')).toBeNull();
  });

  it('should use the given id and the monospace style', () => {
    render(TextField, { label: 'Código', id: 'code', mono: true });

    const input = screen.getByLabelText('Código');
    expect(input.id).toBe('code');
    expect(input.classList.contains('mono')).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('should reflect what the user types', async () => {
    render(TextField, { label: 'Nombre', value: 'a' });
    const input = screen.getByLabelText<HTMLInputElement>('Nombre');

    await fireEvent.input(input, { target: { value: 'Casa' } });

    expect(input.value).toBe('Casa');
  });
});

describe('PasswordField', () => {
  it('should hide the password and show it with the eye button', async () => {
    render(PasswordField, { label: 'Contraseña', autocomplete: 'new-password' });
    const input = screen.getByLabelText('Contraseña');
    const eye = screen.getByRole('button', { name: 'Mostrar contraseña' });

    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(eye.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(eye);

    expect(input.getAttribute('type')).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Checkbox', () => {
  it('should toggle and report the new state', async () => {
    const onchange = vi.fn();
    render(Checkbox, { label: 'Lo he guardado fuera de este móvil', onchange });
    const box = screen.getByRole('checkbox', { name: 'Lo he guardado fuera de este móvil' });

    await fireEvent.click(box);

    expect(onchange).toHaveBeenCalledWith(true);
  });
});
