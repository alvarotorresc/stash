import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountForm,
  Dialog,
  FilterSelect,
  Highlight,
  ItemRow,
  SearchField,
  SelectField,
  SettingsGroup,
  SettingsRow,
  Spinner,
} from './index';
import { text } from './test-utils';

describe('SearchField', () => {
  it('should be a labelled search box with a search key', async () => {
    render(SearchField, { label: 'Buscar en tus guardados', value: '' });
    const input = screen.getByRole('searchbox', { name: 'Buscar en tus guardados' });

    await fireEvent.input(input, { target: { value: 'abono' } });

    expect(input.getAttribute('enterkeyhint')).toBe('search');
    expect((input as HTMLInputElement).value).toBe('abono');
  });
});

describe('FilterSelect', () => {
  const options = [
    { value: 'all', label: 'Todo' },
    { value: 'reddit', label: 'Reddit' },
  ];

  it('should show the chosen option and report changes', async () => {
    const onchange = vi.fn();
    const { container } = render(FilterSelect, {
      label: 'Origen',
      value: 'all',
      options,
      onchange,
    });
    const select = screen.getByRole('combobox', { name: 'Origen' }) as HTMLSelectElement;

    await fireEvent.change(select, { target: { value: 'reddit' } });

    expect(onchange).toHaveBeenCalledWith('reddit');
    expect(container.querySelector('.on')).toBeNull();
  });

  it('should look active when a filter is applied', () => {
    const { container } = render(FilterSelect, {
      label: 'Origen',
      value: 'reddit',
      options,
      onchange: () => {},
      active: true,
    });

    expect(container.querySelector('.filter.on')).toBeTruthy();
  });
});

describe('SelectField', () => {
  it('should have a visible label and report the chosen value', async () => {
    const onchange = vi.fn();
    render(SelectField, {
      label: 'Categoría',
      value: '',
      options: [
        { value: '', label: 'Sin categoría' },
        { value: 'c1', label: 'Casa' },
      ],
      onchange,
    });

    await fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'c1' } });

    expect(onchange).toHaveBeenCalledWith('c1');
  });
});

describe('Highlight', () => {
  it('should bold every match ignoring case and accents', () => {
    const { container } = render(Highlight, {
      text: 'Cómo organizar la despensa: como siempre',
      query: 'como',
    });

    const bold = [...container.querySelectorAll('b')].map((b) => b.textContent);
    expect(bold).toEqual(['Cómo', 'como']);
    expect(container.textContent).toBe('Cómo organizar la despensa: como siempre');
  });

  it('should render the text as is without a query', () => {
    const { container } = render(Highlight, { text: 'abono' });

    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('abono');
  });

  it('should render markup in the text as text', () => {
    const { container } = render(Highlight, {
      text: '<img src=x onerror=alert(1)> abono',
      query: 'abono',
    });

    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ItemRow in search results', () => {
  it('should show the snippet with the query in bold', () => {
    const { container } = render(ItemRow, {
      title: 'Cambios en el transporte',
      origin: 'Reddit, r/Madrid',
      snippet: 'el abono joven se mantiene',
      highlight: 'abono',
      onopen: () => {},
    });

    expect(container.querySelector('.s b')?.textContent).toBe('abono');
  });
});

describe('SettingsGroup and SettingsRow', () => {
  it('should render a titled group with a pressable row', async () => {
    const onclick = vi.fn();
    render(SettingsRow, {
      icon: 'label',
      label: 'Categorías',
      count: 5,
      chevron: true,
      onclick,
    });

    await fireEvent.click(screen.getByRole('button', { name: /Categorías/ }));

    expect(onclick).toHaveBeenCalledOnce();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('should render plain information without onclick', () => {
    render(SettingsRow, {
      icon: 'lock',
      label: 'maria@ejemplo.com',
      description: 'Este dispositivo te recuerda hasta el 5 dic.',
    });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Este dispositivo te recuerda hasta el 5 dic.')).toBeTruthy();
  });

  it('should label the list by its title', () => {
    render(SettingsGroup, { title: 'Tus datos', children: text('fila') });

    expect(screen.getByRole('region', { name: 'Tus datos' })).toBeTruthy();
  });
});

describe('Dialog', () => {
  it('should open as a modal and close with Escape', async () => {
    const onclose = vi.fn();
    const { rerender } = render(Dialog, {
      open: true,
      title: 'Borrar la cuenta',
      onclose,
      children: text('Contenido'),
    });
    const dialog = screen.getByRole('dialog', { name: 'Borrar la cuenta' }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    await fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onclose).toHaveBeenCalledOnce();

    await rerender({ open: false });
    expect(dialog.open).toBe(false);
  });
});

describe('Spinner', () => {
  it('should be decorative', () => {
    const { container } = render(Spinner, { size: 20 });

    expect(container.querySelector('.ring')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('AccountForm', () => {
  it('should submit the email and password when entering', async () => {
    const onsubmit = vi.fn();
    render(AccountForm, { submitLabel: 'Entrar', passwordMode: 'current', onsubmit });

    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'maria@ejemplo.com' },
    });
    await fireEvent.input(screen.getByLabelText('Contraseña'), { target: { value: 'secreto' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(onsubmit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Contraseña').getAttribute('autocomplete')).toBe(
      'current-password',
    );
  });

  it('should show the meter for a new password and the error', () => {
    render(AccountForm, {
      submitLabel: 'Crear cuenta',
      passwordMode: 'new',
      strength: { level: 0, blocked: true, message: 'Muy común: elige otra' },
      error: 'Ese email ya tiene cuenta.',
      onsubmit: () => {},
    });

    expect(screen.getByText('Muy común: elige otra')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Ese email ya tiene cuenta.');
    expect(screen.getByLabelText('Contraseña').getAttribute('autocomplete')).toBe('new-password');
  });

  it('should ignore presses while busy', async () => {
    const onsubmit = vi.fn();
    render(AccountForm, { submitLabel: 'Entrar', passwordMode: 'current', busy: true, onsubmit });

    await fireEvent.click(screen.getByRole('button', { name: 'Entrar…' }));

    expect(onsubmit).not.toHaveBeenCalled();
  });
});
