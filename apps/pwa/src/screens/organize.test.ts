import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';

describe('Categories', () => {
  it('should create a category', async () => {
    const { app } = await renderApp('#/categorias');

    await fireEvent.input(screen.getByLabelText('Nueva categoría'), {
      target: { value: 'Lecturas' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    await waitFor(() => expect(app.categories.map((c) => c.name)).toContain('Lecturas'));
    expect((screen.getByLabelText('Nueva categoría') as HTMLInputElement).value).toBe('');
  });

  it('should rename, reorder and delete, keeping the items', async () => {
    const { app } = await renderApp('#/categorias');
    const list = screen.getByRole('list', { name: 'Categorías' });

    await fireEvent.click(within(list).getByRole('button', { name: /Editar Recetas/ }));
    const field = within(list).getByRole('textbox');
    await fireEvent.input(field, { target: { value: 'Recetas de diario' } });
    await fireEvent.click(within(list).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(app.categories.map((c) => c.name)).toContain('Recetas de diario'));

    await fireEvent.keyDown(within(list).getByRole('button', { name: 'Mover Trabajo' }), {
      key: 'ArrowDown',
    });
    await waitFor(() => expect(app.categories[0]?.name).toBe('Casa'));

    await fireEvent.click(within(list).getByRole('button', { name: /Editar Madrid/ }));
    await fireEvent.click(within(list).getByRole('button', { name: 'Borrar' }));
    expect(
      within(list).getByText(/Sus 3 guardados pasan a Sin clasificar. No se pierde nada./),
    ).toBeTruthy();
    await fireEvent.click(within(list).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(app.categories.map((c) => c.name)).not.toContain('Madrid'));
    expect(app.item('item-abono')?.categoryId).toBeNull();
  });

  it('should explain that changes need the network when offline', async () => {
    await renderApp('#/categorias', { online: false });

    expect(screen.getByText(/hace falta red/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Editar Casa/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Tags', () => {
  it('should list tags alphabetically and rename one everywhere', async () => {
    const { app } = await renderApp('#/ajustes/etiquetas');
    const list = screen.getByRole('list', { name: 'Etiquetas' });
    const names = within(list)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(names[0]).toMatch(/atajos/);

    await fireEvent.click(within(list).getByRole('button', { name: /Editar cena/ }));
    await fireEvent.input(within(list).getByRole('textbox'), { target: { value: 'cenas' } });
    await fireEvent.click(within(list).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(app.item('item-calabaza')?.tags).toContain('cenas'));
  });

  it('should delete a tag without deleting the items', async () => {
    const { app } = await renderApp('#/ajustes/etiquetas');

    await fireEvent.click(screen.getByRole('button', { name: /Editar otoño/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(screen.getByText(/Se quita de 1 guardado. Los guardados no se borran./)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    await waitFor(() => expect(app.item('item-calabaza')?.tags).toEqual(['cena']));
    expect(app.item('item-calabaza')).toBeTruthy();
  });

  it('should say how tags are created when there are none', async () => {
    const { app, service } = await renderApp('#/ajustes/etiquetas');
    for (const tag of [...app.tags]) await service.deleteTag(tag.name);

    expect(await screen.findByText('Aún no tienes etiquetas')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeTruthy();
  });
});
