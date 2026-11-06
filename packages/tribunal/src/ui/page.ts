import { REVIEW_STYLES } from './styles.js';

/**
 * The document that loads the review surface, served by every host that has no
 * framework of its own: the Node service and the packaged Worker.
 *
 * A document, the stylesheet inlined, the faces it names linked, and the
 * configuration the entry reads. The script src and the font sheet's href are
 * **absolute**, and that is not a style choice — this same document is served at
 * every address in [`route.ts`](./route.ts), and a relative `ui/review.js` resolves
 * against the one it was fetched from. On `/builds/7/changes/Button` it asks for
 * `/builds/7/changes/ui/review.js`, gets the router's 404, and renders a blank page
 * with an error in a console nobody opened. The configuration goes in a
 * `application/json` script rather than into the bundle, because the endpoint is a
 * property of a *deployment* and the bundle is built once for all of them.
 *
 * **Nothing about who is looking is written here.** The page is the same for
 * everybody and holds no data, so it is served before anybody is recognized. The
 * script asks `/auth/me` who this is, and every read it makes after that is judged
 * on its own.
 */

export interface ReviewPageOptions {
  /** Where the API is mounted, as the browser will address it. `''` is same-origin. */
  readonly endpoint: string;
}

export function reviewPage(options: ReviewPageOptions): string {
  const configuration = JSON.stringify({ endpoint: options.endpoint });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#181b1d">
<title>Variance Authority — review</title>
<link rel="stylesheet" href="/ui/fonts/fonts.css">
<style>/* This document's own reset, which is why it is here and not in
   REVIEW_STYLES: an operator injects that sheet into a page this package did not
   write, and a component stylesheet that reaches out and restyles the document
   body is a rude guest. This document is ours. Its shell is a hundred dynamic
   viewport units tall, so a default body margin overflows it by exactly twice
   the margin — a scrollbar on the one page whose whole claim is that it does
   not scroll. */
body { margin: 0; }
${REVIEW_STYLES}</style>
</head>
<body>
<div id="variance-review"></div>
<script type="application/json" id="variance-config">${safely(configuration)}</script>
<script type="module" src="/ui/review.js"></script>
</body>
</html>
`;
}

/**
 * `</script>` inside a JSON string ends the script element, whatever the JSON
 * thinks. One replacement, because the value is `JSON.stringify` output and the
 * only sequence that can close the element is this one.
 */
function safely(json: string): string {
  return json.replace(/<\//g, '<\\/');
}
