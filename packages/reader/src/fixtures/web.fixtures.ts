// Hand-written fixtures. No real personal data.

const PARAGRAPH =
  'Plain text tools age well because they do one thing and compose with everything else. ' +
  'This paragraph is long enough for the reader mode to consider it part of the main content, ' +
  'and it repeats the idea so that the score of the container goes above the threshold.';

export const ARTICLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fallback title | Example Blog</title>
  <meta property="og:title" content="  Why plain   text wins  ">
  <meta property="og:description" content="An essay about plain text.">
  <meta property="og:image" content="/images/cover.png">
  <meta property="og:site_name" content="Example Blog">
  <meta name="author" content="Jane Writer">
  <meta property="article:published_time" content="2025-03-04T10:00:00Z">
  <link rel="canonical" href="https://blog.example.com/posts/plain-text">
  <script>window.tracking = true;</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <article>
    <h1>Why plain text wins</h1>
    <p>${PARAGRAPH}</p>
    <p>${PARAGRAPH} See <a href="/notes/unix">the notes</a> and <a href="javascript:alert(1)">this</a>.</p>
    <p><img src="https://tracker.example.net/pixel.png" alt="Diagram" srcset="a.png 2x" onerror="alert(1)"></p>
    <p>${PARAGRAPH}</p>
    <p onclick="alert(1)" style="color:red">${PARAGRAPH}</p>
    <iframe src="https://evil.example.net/frame"></iframe>
    <script>alert('xss')</script>
  </article>
  <footer>Copyright</footer>
</body>
</html>`;

/** Valid HTML5 without `<head>` or `<body>`, like danluu.com. */
export const NO_BODY_HTML = `<!doctype html>
<title>No body here</title>
<h1>A page without body</h1>
<p>${PARAGRAPH}</p>
<p>${PARAGRAPH}</p>
<p>${PARAGRAPH} Unique-word-zebra.</p>`;

export const META_ONLY_HTML = `<!doctype html><html><head>
<title>Short page</title>
<meta name="description" content="Only a description.">
<meta property="article:author" content="https://social.example.com/someone">
<meta property="og:image" content="javascript:alert(1)">
</head><body></body></html>`;

export const BASE_HTML = `<!doctype html><html><head>
<base href="https://cdn.example.org/docs/">
<title>Base</title>
</head><body><article>
<p>${PARAGRAPH} <a href="guide.html">guide</a></p>
<p>${PARAGRAPH}</p>
<p>${PARAGRAPH}</p>
</article></body></html>`;

export const INSTAGRAM_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Example Account on Instagram">
<meta property="og:description" content="A caption about the sky.">
<meta property="og:image" content="https://scontent.example.com/v/photo.jpg?oh=1&amp;oe=2">
</head><body><article><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p></article></body></html>`;

export const X_PAGE_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Example User (@example) on X">
<meta property="og:description" content="just setting up my account">
<meta property="og:image" content="https://pbs.example.com/media/photo.jpg">
<meta property="og:site_name" content="X (formerly Twitter)">
</head><body></body></html>`;
