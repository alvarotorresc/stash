// Hand-written Atom feeds shaped like Reddit's post RSS. No real personal data.

const escape = (html: string) =>
  html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const POST_BODY = escape(
  '<!-- SC_OFF --><div class="md"><p>First paragraph of the post.</p> ' +
    '<p>Read <a href="/r/example/wiki/rules/">the rules</a>.</p>' +
    '<p><img src="x" onerror="alert(1)"><script>alert(1)</script>Second line.</p></div><!-- SC_ON --> ' +
    '&#32; submitted by &#32; <a href="https://www.reddit.com/user/someone"> /u/someone </a> <br/> ' +
    '<span><a href="https://www.reddit.com/r/example/comments/abc123/a_title/">[link]</a></span>',
);

const COMMENT_BODY = escape(
  '<!-- SC_OFF --><div class="md"><p>A comment that must be dropped.</p></div><!-- SC_ON -->',
);

const header = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><category term="example" label="r/example"/><title>A title : example</title>`;

export const REDDIT_RSS = `${header}
<entry><author><name>/u/commenter</name></author><content type="html">${COMMENT_BODY}</content><id>t1_zzz</id><title>/u/commenter on A title</title></entry>
<entry><author><name>/u/someone</name><uri>https://www.reddit.com/user/someone</uri></author><category term="example" label="r/example"/><content type="html">${POST_BODY}</content><id>t3_abc123</id><link href="https://www.reddit.com/r/example/comments/abc123/a_title/" /><updated>2022-11-07T15:08:47+00:00</updated><published>2022-11-07T15:08:47+00:00</published><title>A title</title></entry>
</feed>`;

export const REDDIT_RSS_DELETED_AUTHOR = `${header}
<entry><author><name></name></author><category term="example" label="r/example"/><content type="html">${POST_BODY}</content><id>t3_def456</id><link href="https://www.reddit.com/r/example/comments/def456/other/" /><updated>2014-01-01T00:00:00+00:00</updated><title>Other</title></entry>
</feed>`;

export const REDDIT_RSS_LINK_POST = `${header}
<entry><author><name>/u/someone</name></author><category term="example" label="r/example"/><content type="html">${escape('<table><tr><td><a href="https://news.example.com/story">[link]</a></td></tr></table>')}</content><id>t3_ghi789</id><title>A link post</title></entry>
</feed>`;

export const REDDIT_RSS_NO_ENTRY = `${header}</feed>`;

export const REDDIT_RSS_NOT_XML = '<html><body>Blocked</body>';
