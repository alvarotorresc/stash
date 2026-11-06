// Shaped like the official oEmbed response (publish.twitter.com/oembed?omit_script=1).

export const X_OEMBED = {
  url: 'https://x.com/example/status/20',
  author_name: 'Example User',
  author_url: 'https://x.com/example',
  html:
    '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my account ' +
    '<a href="https://t.co/abc">pic.twitter.com/abc</a><img src=x onerror="alert(1)"></p>' +
    '&mdash; Example User (@example) <a href="https://x.com/example/status/20?ref_src=twsrc%5Etfw">' +
    'March 21, 2006</a></blockquote>\n<script async src="https://platform.example.com/widgets.js"></script>',
  width: 550,
  height: null,
  type: 'rich',
  provider_name: 'X',
  version: '1.0',
};
