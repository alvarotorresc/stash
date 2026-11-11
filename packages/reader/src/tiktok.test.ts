import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import { REAL_TIKTOK_OEMBED, REAL_TIKTOK_PAGE } from './fixtures/real.fixtures';
import { parsePage } from './page';
import { parseTikTok } from './tiktok';

const URL_ = 'https://www.tiktok.com/@themuthership/video/7378294254344342827';

function pageWithState(state: unknown): string {
  return (
    '<html><head><title>TikTok - Make Your Day</title>' +
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>` +
    '</head><body></body></html>'
  );
}

const detail = (value: unknown) => ({ __DEFAULT_SCOPE__: { 'webapp.video-detail': value } });

describe('parseTikTok', () => {
  describe('with the responses recorded from TikTok', () => {
    // The official oEmbed answers today with an iframe and no title, author or thumbnail.
    const result = () => parseTikTok(REAL_TIKTOK_OEMBED, URL_, REAL_TIKTOK_PAGE);

    it('should read the text of the video and its author from the page state', () => {
      expect(result()).toMatchObject({
        source: 'tiktok',
        url: URL_,
        title: expect.stringMatching(/^Replying to @jim97006 To learn how to link a video/),
        description: expect.stringContaining('#LinkTikTokInCaption'),
        author: 'themuthership tiktok helen 💙',
        siteName: 'TikTok',
        publishedAt: '2024-06-09T00:30:06.000Z',
        issues: [],
      });
    });

    it('should keep the cover as the image to download through the proxy', () => {
      expect(result().imageUrl).toMatch(/^https:\/\/p16-common-sign\.tiktokcdn-eu\.com\//);
    });

    it('should be preview only', () => {
      expect(result().content).toEqual({ kind: 'none', text: '' });
    });

    it('should not take the generic title of the page', () => {
      expect(result().title).not.toContain('Make Your Day');
    });

    it('should keep the plain link when nothing was downloaded', () => {
      expect(parseTikTok(null, URL_)).toMatchObject({
        source: 'tiktok',
        title: null,
        description: null,
        imageUrl: null,
        issues: [],
      });
    });

    it('should keep the link when only the oEmbed stub was downloaded', () => {
      expect(parseTikTok(REAL_TIKTOK_OEMBED, URL_)).toMatchObject({
        title: null,
        description: null,
        imageUrl: null,
      });
    });
  });

  describe('with a full oEmbed response', () => {
    const oembed = {
      title: 'Caption of the video #tag',
      author_name: 'Example Creator',
      author_url: 'https://www.tiktok.com/@example',
      thumbnail_url: 'https://p16.example.com/cover.jpeg',
      html: '<iframe src="https://evil.example"></iframe>',
    };

    it('should prefer its title, author and thumbnail', () => {
      const result = parseTikTok(oembed, URL_, REAL_TIKTOK_PAGE);
      expect([result.description, result.author, result.imageUrl]).toEqual([
        'Caption of the video #tag',
        'Example Creator',
        'https://p16.example.com/cover.jpeg',
      ]);
    });

    it('should accept it as a JSON string', () => {
      expect(parseTikTok(JSON.stringify(oembed), URL_).description).toBe(
        'Caption of the video #tag',
      );
    });

    it('should never keep its html', () => {
      expect(JSON.stringify(parseTikTok(oembed, URL_))).not.toContain('evil.example');
    });

    it('should drop a thumbnail that is not a public http(s) URL', () => {
      const result = parseTikTok({ ...oembed, thumbnail_url: 'http://127.0.0.1/cover.jpg' }, URL_);
      expect(result.imageUrl).toBeNull();
    });
  });

  describe('with a page that has no video', () => {
    it.each([
      ['an error status', detail({ statusCode: 10204, statusMsg: "item doesn't exist" })],
      ['no video entry', { __DEFAULT_SCOPE__: {} }],
      ['no scope', {}],
      ['a video entry that is not an object', detail('nope')],
      ['an item without a description', detail({ statusCode: 0, itemInfo: { itemStruct: {} } })],
      ['an item that is not an object', detail({ statusCode: 0, itemInfo: { itemStruct: 5 } })],
    ])('should keep the plain link for %s', (_name, state) => {
      const result = parseTikTok(null, URL_, pageWithState(state));
      expect([result.title, result.description, result.imageUrl, result.author]).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('should keep the plain link when the state is not JSON', () => {
      const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{nope</script>';
      expect(parseTikTok(null, URL_, html)).toMatchObject({ title: null, issues: [] });
    });

    it('should keep the plain link when the page has no state', () => {
      expect(
        parseTikTok(null, URL_, '<html><title>TikTok - Make Your Day</title></html>'),
      ).toMatchObject({ title: null, description: null });
    });
  });

  describe('with a page state of another shape', () => {
    const item = (extra: object) =>
      detail({ statusCode: 0, itemInfo: { itemStruct: { desc: 'A video', ...extra } } });

    it('should fall back to the unique id when the author has no nickname', () => {
      const html = pageWithState(item({ author: { uniqueId: 'someone' } }));
      expect(parseTikTok(null, URL_, html).author).toBe('someone');
    });

    it('should ignore values of the wrong type', () => {
      const html = pageWithState(
        item({ author: 7, video: { cover: 5 }, createTime: 'x', desc: 'A video' }),
      );
      const result = parseTikTok(null, URL_, html);
      expect([result.description, result.author, result.imageUrl, result.publishedAt]).toEqual([
        'A video',
        null,
        null,
        null,
      ]);
    });

    it('should read the date of a numeric createTime', () => {
      const html = pageWithState(item({ createTime: 1717893006 }));
      expect(parseTikTok(null, URL_, html).publishedAt).toBe('2024-06-09T00:30:06.000Z');
    });

    it('should use the share description when the item has none', () => {
      const html = pageWithState(
        detail({ statusCode: 0, shareMeta: { desc: 'From the share meta' } }),
      );
      expect(parseTikTok(null, URL_, html).description).toBe('From the share meta');
    });

    it('should cut a long caption in the title but not in the description', () => {
      const html = pageWithState(item({ desc: 'long '.repeat(100) }));
      const result = parseTikTok(null, URL_, html);
      expect([(result.title ?? '').length <= 120, (result.description ?? '').length > 120]).toEqual(
        [true, true],
      );
    });

    it('should title a video with no caption by its author', () => {
      const html = pageWithState(
        detail({
          statusCode: 0,
          itemInfo: { itemStruct: { desc: '', author: { nickname: 'Someone' } } },
        }),
      );
      expect(parseTikTok(null, URL_, html)).toMatchObject({
        title: 'Someone on TikTok',
        description: null,
      });
    });
  });

  describe('limits', () => {
    it('should only read the page start when it is over the size limit', () => {
      const big = REAL_TIKTOK_PAGE.replace('</body>', `${'x'.repeat(2_200_000)}</body>`);
      const result = parseTikTok(null, URL_, big);
      expect([result.description, result.issues]).toEqual([
        expect.stringContaining('Replying to'),
        ['too_large'],
      ]);
    });

    it('should ignore an oEmbed response over the size limit', () => {
      const huge = JSON.stringify({ title: 'x'.repeat(2_200_000) });
      expect(parseTikTok(huge, URL_)).toMatchObject({ description: null, issues: ['too_large'] });
    });

    it('should record an invalid oEmbed response', () => {
      expect(parseTikTok('{nope', URL_).issues).toEqual(['oembed_invalid']);
    });
  });

  it('should be what parsePage uses for a TikTok page', () => {
    expect(parsePage(REAL_TIKTOK_PAGE, URL_)).toMatchObject({
      source: 'tiktok',
      content: { kind: 'none' },
      description: expect.stringContaining('Replying to'),
    });
  });

  it('should throw ReaderInputError for an invalid url', () => {
    expect(() => parseTikTok(null, 'nope')).toThrow(ReaderInputError);
  });

  it('should throw ReaderInputError when pageHtml is not a string', () => {
    expect(() => parseTikTok(null, URL_, 5 as unknown as string)).toThrow(ReaderInputError);
  });
});
