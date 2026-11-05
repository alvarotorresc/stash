import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import {
  REDDIT_RSS,
  REDDIT_RSS_DELETED_AUTHOR,
  REDDIT_RSS_LINK_POST,
  REDDIT_RSS_NO_ENTRY,
  REDDIT_RSS_NOT_XML,
} from './fixtures/reddit.fixtures';
import { parseRedditRss } from './reddit';

const URL_ = 'https://www.reddit.com/r/example/comments/abc123/a_title/';

describe('parseRedditRss', () => {
  const result = parseRedditRss(REDDIT_RSS, URL_);

  it('should read the post metadata from the t3_ entry', () => {
    expect(result).toMatchObject({
      source: 'reddit',
      canonicalUrl: URL_,
      title: 'A title',
      author: 'u/someone',
      siteName: 'Reddit',
      imageUrl: null,
      publishedAt: '2022-11-07T15:08:47.000Z',
      issues: [],
    });
  });

  it('should keep the post text and drop the comments and the trailer', () => {
    expect(result.content).toMatchObject({
      kind: 'post',
      text: 'First paragraph of the post.\nRead the rules.\nSecond line.',
    });
  });

  it('should sanitize the post html', () => {
    expect(result.content.html).not.toMatch(/<script|onerror|alert|\ssrc=/);
    expect(result.content.html).toContain('href="https://www.reddit.com/r/example/wiki/rules/"');
  });

  it('should use the start of the text as description', () => {
    expect(result.description).toBe('First paragraph of the post. Read the rules. Second line.');
  });

  it('should tolerate a deleted author', () => {
    const deleted = parseRedditRss(REDDIT_RSS_DELETED_AUTHOR, URL_);
    expect([deleted.author, deleted.publishedAt, deleted.content.kind]).toEqual([
      null,
      '2014-01-01T00:00:00.000Z',
      'post',
    ]);
  });

  it('should give a preview without content for a link post', () => {
    const link = parseRedditRss(REDDIT_RSS_LINK_POST, URL_);
    expect(link).toMatchObject({
      title: 'A link post',
      description: 'r/example',
      canonicalUrl: URL_,
      content: { kind: 'none', text: '' },
      issues: ['no_readable_content'],
    });
  });

  it('should fall back to the feed title when there is no entry', () => {
    const empty = parseRedditRss(REDDIT_RSS_NO_ENTRY, URL_);
    expect([empty.title, empty.issues]).toEqual(['A title : example', ['rss_no_entry']]);
  });

  it.each([REDDIT_RSS_NOT_XML, ''])('should degrade to the url for invalid xml %j', (xml) => {
    const invalid = parseRedditRss(xml, URL_);
    expect([invalid.url, invalid.content.kind, invalid.issues]).toEqual([
      URL_,
      'none',
      ['rss_invalid'],
    ]);
  });

  it('should throw ReaderInputError when xml is not a string', () => {
    expect(() => parseRedditRss(undefined as unknown as string, URL_)).toThrow(ReaderInputError);
  });
});
