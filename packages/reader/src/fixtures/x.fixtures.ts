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

function linkOnlyOembed(handle: string, id: string, shortLink: string): string {
  return JSON.stringify({
    url: `https://x.com/${handle}/status/${id}`,
    author_name: 'Gon',
    author_url: `https://x.com/${handle}`,
    html:
      '<blockquote class="twitter-tweet" data-dnt="true"><p lang="zxx" dir="ltr">' +
      `<a href="${shortLink}">${shortLink}</a></p>&mdash; Gon (@${handle}) ` +
      `<a href="https://x.com/${handle}/status/${id}?ref_src=twsrc%5Etfw">November 10, 2026</a>` +
      '</blockquote>\n\n',
    type: 'rich',
    provider_name: 'X',
    version: '1.0',
  });
}

function postPage(title: string, description: string): string {
  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    `<title>${title}</title>` +
    `<meta property="og:title" content="${title.replace(/"/g, '&quot;')}"/>` +
    `<meta property="og:description" content="${description}"/>` +
    '<meta property="og:site_name" content="X (formerly Twitter)"/>' +
    '</head><body></body></html>'
  );
}

/** A post that is only the link to an article of X: the title of the article is in the page. */
export const X_ARTICLE_OEMBED = linkOnlyOembed('gon', '9', 'https://t.co/NmgoXKcsok');
export const X_ARTICLE_PAGE = postPage(
  'Gon on X: "Cómo publicar tu app en App Store y Google Play: la guía completa" / X',
  'https://t.co/NmgoXKcsok',
);
/** The same post when the page also describes the article. */
export const X_ARTICLE_PAGE_WITH_DESCRIPTION = postPage(
  'Gon on X: “Cómo publicar tu app en App Store y Google Play: la guía completa” / X',
  'Todo el camino, de la cuenta de desarrollador a la revisión.',
);

/** A post that is only a link to another site, with nothing about it in the page. */
export const X_EXTERNAL_OEMBED = linkOnlyOembed('gon', '10', 'https://t.co/AbCdEf1234');
export const X_EXTERNAL_PAGE = postPage(
  'Gon on X: "https://t.co/AbCdEf1234" / X',
  'https://t.co/AbCdEf1234',
);

/** A post with text and a link: the text wins. */
export const X_TEXT_AND_LINK_OEMBED = JSON.stringify({
  url: 'https://x.com/gon/status/11',
  author_name: 'Gon',
  author_url: 'https://x.com/gon',
  html:
    '<blockquote class="twitter-tweet"><p lang="es" dir="ltr">Mi guía para publicar en las ' +
    'tiendas <a href="https://t.co/Zz9">https://t.co/Zz9</a></p>&mdash; Gon (@gon) ' +
    '<a href="https://x.com/gon/status/11">November 10, 2026</a></blockquote>',
});
export const X_TEXT_AND_LINK_PAGE = postPage(
  'Gon on X: "Mi guía para publicar en las tiendas https://t.co/Zz9" / X',
  'Mi guía para publicar en las tiendas https://t.co/Zz9',
);
