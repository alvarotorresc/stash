import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import { X_PAGE_HTML } from './fixtures/web.fixtures';
import {
  REAL_X_PHOTO_OEMBED,
  REAL_X_PHOTO_PAGE,
  REAL_X_TEXT_OEMBED,
  REAL_X_TEXT_PAGE,
  REAL_X_VIDEO_OEMBED,
  REAL_X_VIDEO_PAGE,
} from './fixtures/real.fixtures';
import { X_OEMBED } from './fixtures/x.fixtures';
import { parseOembedDate, parseXOembed } from './x';

const URL_ = 'https://twitter.com/example/status/20';

describe('parseXOembed', () => {
  it('should ignore an oEmbed url outside X', () => {
    const result = parseXOembed({ ...X_OEMBED, url: 'https://paypal.com/login' }, URL_);
    expect(result.canonicalUrl).toBe(URL_);
  });

  it('should not parse an oEmbed response over the size limit', () => {
    const huge = JSON.stringify({
      ...X_OEMBED,
      html: `<blockquote><p>${'x'.repeat(2_200_000)}</p></blockquote>`,
    });
    const asString = parseXOembed(huge, URL_);
    const asObject = parseXOembed(JSON.parse(huge), URL_);
    expect([
      asString.issues,
      asString.content.kind,
      asObject.issues,
      asObject.content.kind,
    ]).toEqual([['too_large'], 'none', ['too_large'], 'none']);
  });

  it(
    'should read the metadata from the start of a page over the size limit',
    { timeout: 60_000 },
    () => {
      const page = X_PAGE_HTML.replace('</body>', `${'<p>x</p>'.repeat(300_000)}</body>`);
      const result = parseXOembed(X_OEMBED, URL_, page);
      expect([result.imageUrl, result.issues]).toEqual([
        'https://pbs.example.com/media/photo.jpg',
        ['too_large'],
      ]);
    },
  );

  it('should give no content for a post with too deep markup', () => {
    const deep = `<blockquote><p>${'<span>'.repeat(200)}x${'</span>'.repeat(200)}</p></blockquote>`;
    const result = parseXOembed({ ...X_OEMBED, html: deep }, URL_);
    expect([result.content.kind, result.issues]).toEqual(['none', ['too_large']]);
  });

  it('should read text, author and date from oEmbed', () => {
    const result = parseXOembed(X_OEMBED, URL_);
    expect(result).toMatchObject({
      source: 'x',
      canonicalUrl: 'https://x.com/example/status/20',
      title: 'just setting up my account',
      author: 'Example User',
      siteName: 'X',
      imageUrl: null,
      publishedAt: '2006-03-21',
      content: { kind: 'tweet', text: 'just setting up my account' },
      issues: [],
    });
  });

  it('should sanitize the text of the post', () => {
    const html = parseXOembed(X_OEMBED, URL_).content.html;
    expect(html).toBe(
      'just setting up my account <img data-stash-src="https://twitter.com/example/status/x">',
    );
  });

  it('should take the image from the page metadata and the title from the post', () => {
    const result = parseXOembed(X_OEMBED, URL_, X_PAGE_HTML);
    expect([result.imageUrl, result.title, result.siteName]).toEqual([
      'https://pbs.example.com/media/photo.jpg',
      'just setting up my account',
      'X (formerly Twitter)',
    ]);
  });

  it('should accept the oEmbed response as a JSON string', () => {
    expect(parseXOembed(JSON.stringify(X_OEMBED), URL_).content.kind).toBe('tweet');
  });

  it.each([['{not json'], [42], [{ html: 7 }], [{}], [[]]])(
    'should degrade and record an issue for an invalid oEmbed %j',
    (oembed) => {
      const result = parseXOembed(oembed, URL_);
      expect([result.content.kind, result.issues, result.url]).toEqual([
        'none',
        ['oembed_invalid'],
        URL_,
      ]);
    },
  );

  it('should fall back to og:description when oEmbed is invalid', () => {
    const result = parseXOembed('{not json', URL_, X_PAGE_HTML);
    expect(result.content).toEqual({ kind: 'tweet', text: 'just setting up my account' });
  });

  it('should not record an issue when no oEmbed is given', () => {
    expect(parseXOembed(undefined, URL_).issues).toEqual([]);
  });

  it('should leave the date empty when it does not parse', () => {
    const oembed = {
      ...X_OEMBED,
      html: '<blockquote><p>hi</p>&mdash; x <a href="https://x.com/a">yesterday</a></blockquote>',
    };
    expect(parseXOembed(oembed, URL_).publishedAt).toBeNull();
  });

  it('should use the author name alone when the post has no text and no author url', () => {
    const oembed = { html: '<blockquote><p></p></blockquote>', author_name: 'Example User' };
    expect(parseXOembed(oembed, URL_).title).toBe('Example User on X');
  });

  it('should use the page title when the post has no text', () => {
    const oembed = { html: '<blockquote><p></p></blockquote>', author_name: 'Example User' };
    const page = '<title>Someone (@someone) on X</title>';
    expect(parseXOembed(oembed, URL_, page).title).toBe('Someone (@someone) on X');
  });

  it('should cut a long post to a short title', () => {
    const oembed = { html: `<blockquote><p>${'word '.repeat(80)}</p></blockquote>` };
    const title = parseXOembed(oembed, URL_).title ?? '';
    expect([title.length <= 120, title.startsWith('word word')]).toEqual([true, true]);
  });

  it('should throw ReaderInputError for an invalid url', () => {
    expect(() => parseXOembed(X_OEMBED, 'nope')).toThrow(ReaderInputError);
  });

  it('should throw ReaderInputError when pageHtml is not a string', () => {
    expect(() => parseXOembed(X_OEMBED, URL_, 5 as unknown as string)).toThrow(ReaderInputError);
  });
});

describe('parseOembedDate', () => {
  it.each([
    ['March 21, 2006', '2006-03-21'],
    ['november 5, 2026', '2026-11-05'],
    ['Smarch 1, 2006', null],
    ['March 32, 2006', null],
    ['21 March 2006', null],
    [null, null],
  ])('should parse %s as %s', (value, expected) => {
    expect(parseOembedDate(value)).toBe(expected);
  });
});

describe('parseXOembed with responses recorded from X', () => {
  const photo = () => parseXOembed(REAL_X_PHOTO_OEMBED, URL_, REAL_X_PHOTO_PAGE);
  const video = () => parseXOembed(REAL_X_VIDEO_OEMBED, URL_, REAL_X_VIDEO_PAGE);
  const text = () => parseXOembed(REAL_X_TEXT_OEMBED, URL_, REAL_X_TEXT_PAGE);

  it('should title a post with its text, not with "Name (@handle) on X"', () => {
    expect([photo().title, video().title, text().title]).toEqual([
      'Good morning from MAX POWER @NASAKennedy!✈️ The tech toys are on display, aircraft are fueled up, and NASA experts are…',
      'American ambition. Maximum power. We didn’t reach for the stars to stop pushing farther. Under @POTUS’ leadership, we’r…',
      'just setting up my twttr',
    ]);
  });

  it('should keep the author, date and the image of a post with a photo', () => {
    expect(photo()).toMatchObject({
      author: 'NASA',
      publishedAt: '2026-11-07',
      imageUrl: 'https://pbs.twimg.com/media/HWiEO6Ca8AAn4oC?format=webp&name=large',
    });
  });

  it('should take the thumbnail of a post with a video as its image', () => {
    expect(video().imageUrl).toContain('https://pbs.twimg.com/amplify_video_thumb/');
  });

  it('should drop the t.co link to the media from the text', () => {
    expect([photo().content.text, video().content.text]).toEqual([
      expect.not.stringContaining('pic.twitter.com'),
      expect.not.stringContaining('pic.twitter.com'),
    ]);
  });

  it('should not use the avatar of a text-only post as its image', () => {
    expect(text().imageUrl).toBeNull();
  });

  it('should keep the text of a post whose page was not downloaded', () => {
    const result = parseXOembed(REAL_X_PHOTO_OEMBED, URL_);
    expect([result.content.kind, result.title, result.imageUrl]).toEqual([
      'tweet',
      expect.stringContaining('Good morning from MAX POWER'),
      null,
    ]);
  });

  it('should keep the text, author and image of a post whose oEmbed failed', () => {
    const result = parseXOembed(null, URL_, REAL_X_VIDEO_PAGE);
    expect([result.content.text.startsWith('American ambition'), result.imageUrl]).toEqual([
      true,
      expect.stringContaining('amplify_video_thumb'),
    ]);
  });
});
