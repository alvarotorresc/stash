import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import {
  ArticleContent,
  PreviewContent,
  ReadingView,
  RedditContent,
  TweetContent,
  type SanitizedHtml,
} from '../index';
import { text } from '../test-utils';

const html = (value: string) => value as SanitizedHtml;

function view(extra: Record<string, unknown> = {}) {
  const props = {
    onback: vi.fn(),
    onclassify: vi.fn(),
    ondiscard: vi.fn(),
    onmarkread: vi.fn(),
    children: text('contenido'),
    ...extra,
  };
  render(ReadingView, props);
  return props;
}

describe('ReadingView', () => {
  it('should offer the original, the classification and the two actions', async () => {
    const props = view({
      link: { label: 'Abrir original', href: 'https://example.com/a' },
      category: 'Casa',
      priority: 'high',
      tags: ['despensa'],
    });

    expect(screen.getByRole('link', { name: 'Abrir original' })).toBeTruthy();
    const classify = screen.getByRole('button', { name: 'Clasificar: Casa Alta despensa' });
    await fireEvent.click(classify);
    await fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Marcar leído' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(props.onclassify).toHaveBeenCalledOnce();
    expect(props.ondiscard).toHaveBeenCalledOnce();
    expect(props.onmarkread).toHaveBeenCalledOnce();
    expect(props.onback).toHaveBeenCalledOnce();
  });

  it('should invite to classify when nothing is set', () => {
    view();

    expect(screen.getByRole('button', { name: 'Clasificar: Sin clasificar' })).toBeTruthy();
  });

  it('should keep reading offline but explain why the actions wait', async () => {
    const props = view({ online: false });

    expect(screen.queryByRole('button', { name: /^Clasificar/ })).toBeNull();
    const read = screen.getByRole('button', { name: 'Marcar leído' });
    expect(read.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(read.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('marcar y clasificar esperan a la red');

    await fireEvent.click(read);
    await fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(props.onmarkread).not.toHaveBeenCalled();
    expect(props.ondiscard).not.toHaveBeenCalled();
  });
});

describe('ArticleContent', () => {
  it('should render the source, title, image and the sanitized body', () => {
    const { container } = render(ArticleContent, {
      source: 'lacocinaordenada.es · 6 min',
      title: 'Cómo organizar la despensa',
      image: { src: 'blob:img', alt: 'Una despensa ordenada' },
      html: html('<p>Lo primero es sacar todo.</p>'),
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cómo organizar la despensa' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Una despensa ordenada' })).toBeTruthy();
    expect(container.querySelector('.rich p')?.textContent).toBe('Lo primero es sacar todo.');
  });

  it('should skip the image when there is none', () => {
    render(ArticleContent, { source: 's', title: 't', html: html('<p>x</p>') });

    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('TweetContent', () => {
  it('should show initials instead of a photo, the text, images and date', () => {
    const { container } = render(TweetContent, {
      author: { name: 'Marta Gil', handle: '@martagil_dev' },
      html: html('<p>Los atajos de VS Code</p>'),
      images: [{ src: 'blob:1', alt: 'Captura de atajos' }],
      date: '14 oct. 2026, 18:02',
    });

    expect(container.querySelector('.av')?.textContent).toBe('MG');
    expect(screen.getByRole('heading', { name: 'Marta Gil' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Captura de atajos' })).toBeTruthy();
    expect(screen.getByText('14 oct. 2026, 18:02')).toBeTruthy();
    expect(container.querySelector('.rich.tweet')).toBeTruthy();
  });

  it('should work without images', () => {
    render(TweetContent, {
      author: { name: 'ana', handle: '@ana' },
      html: html('hola'),
      date: 'hoy',
    });

    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('RedditContent', () => {
  it('should say that comments are not saved', () => {
    render(RedditContent, {
      source: 'r/askspain · u/carmen_rv',
      title: '¿Compensa el abono anual?',
      html: html('<p>Voy a la oficina tres días.</p>'),
    });

    expect(screen.getByRole('heading', { name: '¿Compensa el abono anual?' })).toBeTruthy();
    expect(screen.getByText('Sin comentarios.')).toBeTruthy();
  });
});

describe('PreviewContent', () => {
  it('should show the preview and a button to the original', () => {
    render(PreviewContent, {
      title: '@verduradetemporada en Instagram',
      description: 'Crema de calabaza asada',
      image: { src: 'blob:p', alt: 'Vista previa' },
      open: { label: 'Abrir en Instagram', href: 'https://instagram.com/p/1' },
      note: 'De Instagram, Stash guarda la vista previa y el enlace.',
    });

    const link = screen.getByRole('link', { name: 'Abrir en Instagram' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(
      screen.getByText('De Instagram, Stash guarda la vista previa y el enlace.'),
    ).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('should explain when the source blocked reading', () => {
    render(PreviewContent, {
      title: 'Marta Gil en X',
      open: { label: 'Abrir en X', href: 'https://x.com/a' },
      blocked: {
        title: 'X no ha dejado leer este post',
        text: 'Tienes la vista previa y el enlace. Lo guardado no se pierde.',
      },
    });

    expect(screen.getByRole('status').textContent).toContain('X no ha dejado leer este post');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
