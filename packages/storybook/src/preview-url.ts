
/**
 * The one URL a preview is addressed by, and every base that is not one.
 *
 * Separate because it needs no page, no channel and no browser: it is a pure
 * function over a string, and every mistake it catches was made before a run
 * started. That is also why it is tested on its own. Each refusal below names
 * the URL that was wanted rather than reporting the symptom, because a base that
 * is wrong in a plausible way — a link copied out of the manager, a host and port
 * with no scheme — otherwise survives to a resolution failure whose message is
 * about `iframe.html` and says nothing about the actual mistake.
 */

/** Path a built Storybook serves its preview from, relative to the base URL. */
export const PREVIEW_PATH = 'iframe.html';

/**
 * Build the preview URL for one story.
 *
 * `viewMode=story` is explicit rather than left to default, because the
 * alternative — `docs` — renders a page of prose around the component and would
 * be captured as the subject.
 */
export function previewUrl(baseUrl: string, storyId: string): string {
  if (storyId === '') throw new Error('a story id is required to build a preview URL');

  const url = new URL(PREVIEW_PATH, previewBase(baseUrl));
  url.searchParams.set('id', storyId);
  url.searchParams.set('viewMode', 'story');
  return url.href;
}

function previewBase(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `\`${baseUrl}\` is not a URL. The Storybook base is absolute — \`http://localhost:6006\` for ` +
        `a dev server, or a \`file://\` path to a built Storybook directory.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
    // `localhost:6006` parses: `localhost:` becomes the protocol and `6006` the
    // path, so the omitted scheme survives all the way to a resolution failure
    // three lines later with a message about `iframe.html`. Caught here, where
    // the actual mistake is.
    throw new Error(
      `\`${baseUrl}\` has protocol \`${url.protocol}\`. The Storybook base is an absolute ` +
        `\`http\`, \`https\`, or \`file\` URL — a host and port with no scheme parses as a ` +
        `protocol rather than as a host.`,
    );
  }

  if (url.search !== '' || url.hash !== '') {
    // `http://localhost:6006/?path=/story/button--primary` is a link copied out
    // of the manager, and its query would be silently dropped by the join below.
    // Refusing says which URL is wanted; dropping would produce a preview URL
    // that works and quietly ignores half of what was asked for.
    throw new Error(
      `\`${baseUrl}\` carries a query or fragment. The Storybook base is its root URL, not a link ` +
        `copied from the manager; story selection is this function's job.`,
    );
  }

  // A base naming the preview itself is the likelier typo than a directory
  // actually called `iframe.html`, and joining onto it yields `iframe.html/iframe.html`.
  if (url.pathname.endsWith(`/${PREVIEW_PATH}`)) {
    url.pathname = url.pathname.slice(0, -PREVIEW_PATH.length);
  } else if (!url.pathname.endsWith('/')) {
    // Without this the last path segment is treated as a file and replaced, so
    // `http://host/storybook` would resolve to `http://host/iframe.html`.
    url.pathname = `${url.pathname}/`;
  }

  return url;
}
