import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { PasswordMeter, RecoveryCodeScreen } from '../index';

describe('PasswordMeter', () => {
  it('should show the level and the message it receives', () => {
    const { container } = render(PasswordMeter, {
      strength: { level: 3, blocked: false, message: 'Buena contraseña' },
      id: 'pw-note',
    });

    expect(container.querySelectorAll('.bar.on')).toHaveLength(3);
    const message = screen.getByText('Buena contraseña');
    expect(message.id).toBe('pw-note');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('.blocked')).toBeNull();
  });

  it('should mark a blocked password', () => {
    const { container } = render(PasswordMeter, {
      strength: { level: 1, blocked: true, message: 'Muy común: elige otra' },
    });

    expect(container.querySelector('.meter.blocked')).toBeTruthy();
  });

  it('should stay empty without a result', () => {
    const { container } = render(PasswordMeter, { strength: null });

    expect(container.querySelectorAll('.bar.on')).toHaveLength(0);
    expect(container.querySelector('.msg')?.textContent).toBe('');
  });
});

describe('RecoveryCodeScreen', () => {
  const code = 'k7qf2m9xwd4r8htnc3pv6yjbq2ze';

  function setup(extra: Record<string, unknown> = {}) {
    const props = { code, oncopy: vi.fn(), ondownload: vi.fn(), oncontinue: vi.fn(), ...extra };
    const view = render(RecoveryCodeScreen, props);
    return { ...props, ...view };
  }

  it('should show the code in seven groups of four', () => {
    const { container } = setup();

    const groups = [...container.querySelectorAll('.g')].map((g) => g.textContent);
    expect(groups).toEqual(['K7QF', '2M9X', 'WD4R', '8HTN', 'C3PV', '6YJB', 'Q2ZE']);
    expect(screen.getByRole('heading', { name: 'Tu código de recuperación' })).toBeTruthy();
  });

  it('should spell the code for screen readers', () => {
    const { container } = setup({ code: 'K7QF 2M9X' });

    expect(container.querySelector('.visually-hidden')?.textContent).toBe('K 7 Q F, 2 M 9 X');
  });

  it('should copy and download', async () => {
    const { oncopy, ondownload } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));

    expect(oncopy).toHaveBeenCalledOnce();
    expect(ondownload).toHaveBeenCalledOnce();
  });

  it('should confirm the copy', () => {
    setup({ copied: true });

    expect(screen.getByRole('button', { name: 'Copiado' })).toBeTruthy();
  });

  it('should only continue after the box is checked', async () => {
    const { oncontinue } = setup();
    const next = screen.getByRole('button', { name: 'Continuar' });

    expect(next.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(next);
    expect(oncontinue).not.toHaveBeenCalled();

    await fireEvent.click(
      screen.getByRole('checkbox', { name: 'Lo he guardado fuera de este móvil' }),
    );
    expect(next.getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(next);
    expect(oncontinue).toHaveBeenCalledOnce();
  });

  it('should render no groups for an empty code', () => {
    const { container } = setup({ code: '' });

    expect(container.querySelectorAll('.g')).toHaveLength(0);
  });
});
