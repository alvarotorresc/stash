import { FakeBackend, webPage } from '@stash/client/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { realDevice, renderRealApp } from '../test-utils';

/**
 * The account and save flows on the real service: the key chain, encryption, the
 * encrypted cache and sync, against the in-memory API.
 */

const EMAIL = 'maria@ejemplo.com';
const PASSWORD = 'calabaza-asada-2026';
const ARTICLE = 'https://blog.example.com/despensa';

const devices: ReturnType<typeof realDevice>[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) {
    await device.stash.idle();
    device.stash.dispose();
  }
});

function newDevice(backend = new FakeBackend()) {
  const device = realDevice(backend);
  devices.push(device);
  return device;
}

async function signedUpDevice(backend = new FakeBackend()) {
  const device = newDevice(backend);
  await device.service.register(EMAIL, PASSWORD);
  await device.stash.idle();
  return device;
}

const type = (label: string, value: string, within_: HTMLElement = document.body) =>
  fireEvent.input(within(within_).getByLabelText(label), { target: { value } });

describe('Accounts on the real service', () => {
  it('should create the account, show the recovery code once and open the drawer', async () => {
    const { app, backend } = await renderRealApp('#/crear-cuenta', newDevice());

    await type('Email', EMAIL);
    await type('Contraseña', PASSWORD);
    await fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu código de recuperación' });
    const code = app.recoveryCode;
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
    expect({ code: /^[0-9A-Z]{28}$/.test(code ?? ''), users: backend.accounts.users.size }).toEqual(
      { code: true, users: 1 },
    );
    expect(app.recoveryCode).toBeNull();
  });

  it('should say when the password is wrong and enter with the right one', async () => {
    const phone = await signedUpDevice();
    await renderRealApp('#/entrar', newDevice(phone.backend));

    await type('Email', EMAIL);
    await type('Contraseña', 'no-es-esta-clave');
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('El email o la contraseña no son correctos.')).toBeTruthy();

    await type('Contraseña', PASSWORD);
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendientes' })).toBeTruthy();
  });

  it('should log out from the settings and come back to the sign-in screen', async () => {
    const device = await signedUpDevice();
    const { app, stash } = await renderRealApp('#/ajustes', device);
    await screen.findByRole('heading', { name: 'Ajustes' });

    await fireEvent.click(screen.getByRole('button', { name: /Cerrar sesión/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeTruthy();
    expect({ session: app.session, items: stash.sync.listItems().length }).toEqual({
      session: null,
      items: 0,
    });
  });

  it('should change the password from the settings', async () => {
    const device = await signedUpDevice();
    await renderRealApp('#/ajustes', device);
    await screen.findByRole('heading', { name: 'Ajustes' });

    await fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cambiar contraseña' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));
    expect(within(dialog).getByText(/Escribe la contraseña actual y la nueva/)).toBeTruthy();

    await type('Contraseña actual', 'no-es-esta-clave', dialog);
    await type('Contraseña nueva', 'password123', dialog);
    expect(within(dialog).getByText('Muy común: elige otra')).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));
    expect(within(dialog).getByText(/al menos 10 caracteres/)).toBeTruthy();

    await type('Contraseña nueva', 'pimiento-rojo-asado', dialog);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));
    expect(await within(dialog).findByText('La contraseña no es correcta.')).toBeTruthy();

    await type('Contraseña actual', PASSWORD, dialog);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByText(/Contraseña cambiada/)).toBeTruthy();

    const laptop = newDevice(device.backend);
    await laptop.service.login(EMAIL, 'pimiento-rojo-asado');
    expect((await laptop.service.getSession())?.email).toBe(EMAIL);
  });
});

describe('Saving and reading on the real service', () => {
  it('should save a shared link at once and read its page on the device', async () => {
    const device = await signedUpDevice();
    device.backend.pages.set(
      ARTICLE,
      webPage(ARTICLE, 'Cómo ordenar la despensa', ['Garbanzos, lentejas y arroz en botes.']),
    );
    const { app, stash } = await renderRealApp(`?share=${encodeURIComponent(ARTICLE)}#/`, device);

    const sheet = await screen.findByRole('dialog', { name: /Guardado:/ });
    await fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(app.sheet).toBeNull());
    await stash.idle();
    const saved = await waitFor(() => {
      const item = app.items.find((entry) => entry.url === ARTICLE);
      expect(item?.title).toBe('Cómo ordenar la despensa');
      return item;
    });
    app.router.go({ name: 'item', id: saved?.id ?? '' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cómo ordenar la despensa' }),
    ).toBeTruthy();
    expect(screen.getByText(/lentejas y arroz/)).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('should keep a link shared offline in the queue', async () => {
    const device = await signedUpDevice();
    device.backend.online = false;

    await renderRealApp(`?share=${encodeURIComponent(ARTICLE)}#/`, device);

    expect(await screen.findByRole('dialog', { name: /En cola|Guardado/ })).toBeTruthy();
    expect(device.stash.sync.pendingUploads()).toBe(1);
  });

  it('should say a change needs the network and stay on the item', async () => {
    const device = await signedUpDevice();
    const saved = await device.service.save(ARTICLE);
    await device.stash.idle();
    const { app } = await renderRealApp(`#/leer/${saved.id}`, device);
    await waitFor(() => expect(app.router.route.name).toBe('item'));
    device.backend.online = false;

    await app.markRead(saved.id);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Sin conexión/);
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(app.failure).toBeNull();
  });

  async function saveAndOpen(device: ReturnType<typeof realDevice>, url: string) {
    const { app, stash } = await renderRealApp(`?share=${encodeURIComponent(url)}#/`, device);
    const sheet = await screen.findByRole('dialog', { name: /Guardado:/ });
    await fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(app.sheet).toBeNull());
    await stash.idle();
    const saved = await waitFor(() => {
      const item = app.items.find((entry) => entry.url === url);
      expect(item?.title).not.toBe(url);
      return item;
    });
    return { app, saved };
  }

  it('should show a TikTok video with its caption and a link to the original', async () => {
    const device = await signedUpDevice();
    const video = 'https://www.tiktok.com/@ana/video/7378294254344342827';
    const state = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              desc: 'Cómo ordenar la despensa #orden',
              author: { uniqueId: 'ana', nickname: 'Ana' },
            },
          },
        },
      },
    };
    const page = `<html><head><title>TikTok - Make Your Day</title><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script></head><body></body></html>`;
    device.backend.pages.set(video, {
      kind: 'tiktok',
      oembed: null,
      page: { url: video, contentType: 'text/html', body: page, truncated: false },
    });

    const { app, saved } = await saveAndOpen(device, video);
    expect(saved).toMatchObject({ source: 'tiktok', origin: '@ana' });
    app.router.go({ name: 'item', id: saved?.id ?? '' });

    expect(await screen.findByText('@ana en TikTok')).toBeTruthy();
    expect(screen.getByText('De TikTok, Stash guarda la vista previa y el enlace.')).toBeTruthy();
    expect(screen.getAllByText(/Cómo ordenar la despensa #orden/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Abrir en TikTok/ })).toHaveLength(1);
  });

  it('should title a post on X with its text', async () => {
    const device = await signedUpDevice();
    const post = 'https://x.com/jack/status/20';
    const oembed = JSON.stringify({
      url: post,
      author_name: 'jack',
      author_url: 'https://x.com/jack',
      html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>',
    });
    device.backend.pages.set(post, {
      kind: 'x',
      oembed: { url: post, contentType: 'application/json', body: oembed, truncated: false },
      page: null,
    });

    const { saved } = await saveAndOpen(device, post);

    expect(saved?.title).toBe('just setting up my twttr');
  });
});

describe('Thumbnails on the real service', () => {
  it('should show the decrypted thumbnail in the list and in the reading view', async () => {
    const backend = new FakeBackend();
    const image = 'https://cdn.example.com/cover.jpg';
    backend.pages.set(ARTICLE, webPage(ARTICLE, 'La despensa', ['Garbanzos con calabaza.'], image));
    backend.images.set(image, { type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) });
    const make = async () => ({ type: 'image/webp' as const, bytes: new Uint8Array([1, 2, 3]) });
    const device = realDevice(backend, undefined, make);
    devices.push(device);
    await device.service.register(EMAIL, PASSWORD);
    await device.service.save(ARTICLE);
    await device.stash.idle();

    await renderRealApp('#/', device);
    const row = await screen.findByRole('button', { name: /La despensa/ });
    const inList = within(row).getByRole('presentation', { hidden: true });
    await fireEvent.click(row);
    await screen.findByRole('button', { name: 'Marcar leído' });

    expect({
      list: inList.getAttribute('src')?.startsWith('blob:'),
      reading: document.querySelectorAll('img[src^="blob:"]').length > 0,
      thirdParty: [...document.querySelectorAll('img')].some((img) =>
        (img.getAttribute('src') ?? '').includes('cdn.example.com'),
      ),
    }).toEqual({ list: true, reading: true, thirdParty: false });
  });
});
