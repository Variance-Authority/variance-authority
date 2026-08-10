/**
 * A subject list nobody had to write down.
 *
 * The no-code on-ramp this category is bought for: Percy takes a sitemap, a URL
 * list or a static directory and needs no code changes at all, and a `routes` map
 * copied out of a sitemap by hand is the same list twice — one of which is
 * maintained.
 *
 * **A sitemap is not a test plan, and this does not pretend otherwise.** It is
 * whatever the application chose to publish, which is why the collector states
 * how many entries it found and refuses an empty one rather than planning a run
 * over nothing. What it buys is that a page added to the site is watched without
 * a second commit; what it costs is that a page *removed* from the sitemap stops
 * being watched, silently, which is the trade `subjects.kind: "list"` exists for
 * when it matters.
 */

/**
 * The `<loc>` values in a sitemap, in document order.
 *
 * A regex rather than an XML parser, and the reason is the one this project keeps
 * arriving at: the question is *which URLs does this document list*, which needs
 * no tree, no namespaces and no dependency. A sitemap index — a sitemap of
 * sitemaps — is not followed, because fetching what a fetched document points at
 * is a crawler, and a crawler is a different product with a different failure
 * mode.
 */
export function locationsIn(xml: string): readonly string[] {
  const found: string[] = [];

  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = match[1];
    if (url !== undefined && url !== '') found.push(decodeEntities(url));
  }

  return found;
}

/**
 * A URL as a subject id: its path, without the leading slash.
 *
 * Stable across environments on purpose. Keying by the whole URL would make a
 * staging run and a production run two different suites with two sets of
 * baselines, and the page is the same page. A trailing slash collapses to the
 * name below it, and the site root becomes `/` rather than an empty id — an
 * id nothing can name is an id nothing can `--subjects` or accept.
 */
export function subjectIdFor(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }

  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.replace(/^\/+/, '');
}

/**
 * Routes from a sitemap's own `<loc>` entries.
 *
 * Two URLs whose paths collide — `https://a/x` and `https://b/x` — would be one
 * subject with two addresses, and whichever came last would silently own it. That
 * is refused by name: a sitemap listing one path twice is a sitemap the operator
 * has to look at, and guessing is how a run watches one page while reporting
 * another.
 */
export function routesFrom(xml: string): Readonly<Record<string, string>> {
  const routes: Record<string, string> = {};

  for (const url of locationsIn(xml)) {
    const id = subjectIdFor(url);
    const existing = routes[id];

    if (existing !== undefined && existing !== url) {
      throw new Error(
        `this sitemap lists two URLs whose paths are both \`${id}\` (${existing} and ${url}). ` +
          'One subject cannot have two addresses, and picking either would watch one page while ' +
          'reporting the other — list the routes explicitly instead',
      );
    }

    routes[id] = url;
  }

  return routes;
}

/**
 * Fetch a sitemap and turn it into routes.
 *
 * Every failure here is loud. A run that answered an unreachable sitemap with an
 * empty plan would report a clean suite that observed nothing — the exact shape
 * of green-over-unwatched this project refuses everywhere else — so an empty
 * sitemap is refused as firmly as a missing one.
 */
export async function discover(sitemap: string): Promise<Readonly<Record<string, string>>> {
  let xml: string;
  try {
    const response = await fetch(sitemap);
    if (!response.ok) {
      throw new Error(`the sitemap at ${sitemap} answered ${response.status}`);
    }
    xml = await response.text();
  } catch (error) {
    throw new Error(
      `the sitemap at ${sitemap} could not be read (${error instanceof Error ? error.message : String(error)}). ` +
        'A run that answered this with an empty plan would report a clean suite that observed ' +
        'nothing',
      { cause: error },
    );
  }

  const routes = routesFrom(xml);
  if (Object.keys(routes).length === 0) {
    throw new Error(
      `the sitemap at ${sitemap} lists no <loc> entries, so this run has no subjects. ` +
        'Planning zero subjects and exiting 0 is indistinguishable from a suite that passed',
    );
  }

  return routes;
}

/**
 * Routes from the HTML files in a built directory.
 *
 * `index.html` in a directory becomes that directory's own address — `about/`
 * rather than `about/index.html` — because that is the URL the site will be
 * deployed at, and a baseline keyed on the file name would be a baseline for a
 * page nobody visits. The root's `index.html` becomes `/`, for the reason
 * `subjectIdFor` gives it a name at all.
 */
export function routesFromFiles(
  files: readonly string[],
  baseUrl: string,
): Readonly<Record<string, string>> {
  const routes: Record<string, string> = {};

  for (const file of [...files].sort()) {
    const path = file.replace(/\\/g, '/').replace(/(^|\/)index\.html$/, '$1');
    const url = `${baseUrl.replace(/\/+$/, '')}/${path}`;
    routes[subjectIdFor(url)] = url;
  }

  return routes;
}

/**
 * Exactly one source of subjects, or a refusal naming what was given.
 *
 * Two lists cannot be one. Merging them quietly is how a run ends up watching a
 * page nobody listed — and an empty `routes` is refused for the mirror reason a
 * sitemap with no entries is: a run over no subjects that exits 0 is
 * indistinguishable from a suite that passed.
 */
export function declaredOnce(options: {
  readonly routes?: Readonly<Record<string, string>>;
  readonly sitemap?: string;
  readonly directory?: string;
}): void {
  const given = (['routes', 'sitemap', 'directory'] as const).filter(
    (name) => options[name] !== undefined,
  );

  if (given.length > 1) {
    throw new Error(
      `routeCollector was given ${given.join(' and ')}. Two lists cannot be one, and merging ` +
        'them quietly is how a run watches a page nobody listed — declare one',
    );
  }

  if (
    given.length === 0 ||
    (options.routes !== undefined && Object.keys(options.routes).length === 0)
  ) {
    throw new Error(
      'routeCollector needs at least one route, or a `sitemap` or `directory` to discover them; ' +
        'a run over no subjects is not a run',
    );
  }
}

/** The five XML entities, which are the only ones a sitemap may contain. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
