# site

The public product and documentation site for
**[Variance Authority](../README.md)**. It is a [vinext](https://vinext.dev/)
app deployed to Cloudflare Workers, published at
<https://variance-authority.dev>.

Its dependencies are its own: `site/package.json` is not in the root
`workspaces` array and `site/yarn.lock` is a separate lockfile, so installing
and deploying the site builds none of the packages it describes. Its *content*
is not its own. The build reads the repository's Markdown directly —
`../docs/*.md` and `../packages/*/README.md`, imported with Vite's `?raw` — so
it needs a checkout of the whole repository, not just this directory.

The build requires Node 22 or newer. `/` is the browser-facing presentation
route. Technical truth stays in `../docs` and the package READMEs; `/docs`,
`/start`, `/agents`, and `/reference` render that Markdown and add navigation
and figures without creating another contract.

Every article also serves its Markdown beside it, at `<path>/index.md`,
with repository links repointed at the Markdown of the page they name.
`/llms.txt` indexes the complete publication catalogue. The question home, theory
and reference indexes, and section navigation select from that catalogue, so
a reader can find the same material through a direct question or a complete
index. Each page names the index in its head as `rel="describedby"`; an article
also names its own Markdown as `rel="alternate"`, and every response — page, `robots.txt`, Markdown
— names the index again in a `Link:` header, so a reader that fetches a URL
without rendering it is told where the source starts.

Run every command below from `site/`, in a checkout of the repository:

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # vinext build, into dist/
yarn start       # wrangler dev against dist/server/wrangler.json; build first
yarn deploy      # build first, and wrangler login; deploys to Cloudflare
```

## What the visual review watches

Every page `sitemap.xml` lists is a subject of the `site` check in
`.github/workflows/variance.yml`, read from the build `yarn start` serves:
`variance.config.json` here, and the collector in `variance/routes.mjs`. A page
added to `NAVIGATION` is watched without an edit there. The check builds with
`yarn build --mode unminified`: the production build with its script left
unminified, so a change names the client component that wrote it,
`NavigationLinks`, and not a minified `wo`. A server component leaves no name
in a production build, so a change inside one is named by the nearest client
component above it. To run the check against your own build, build it that
way, start the server and, from the repository root, run the line below.

```bash
node packages/cli/dist/bin.js run --config site/variance.config.json
```

A change it finds is accepted on the pull request with the `variance: accept
site` label.

A pull request that changes nothing the site is built from or photographed
with does not run it: nothing here, nothing a page here reaches, nothing the
run loads and nothing of the job itself. The check still reports, green, and
its summary names why. `tools/site-reach.mjs` makes that call, and `main`
always runs.

## What the edge serves

Every `page.tsx` and `route.ts` declares `export const revalidate`. That
declaration is what the build renders on: a route that does not say how long
its output stays good is rendered per request and answered `cache-control:
no-store`, which Cloudflare will not store. With it, `yarn build` writes every
page, RSC payload and `index.md` into `dist/server/prerendered-routes/`, the
deploy warms those paths, and the edge answers a reader without running a
render. Give a new route the same declaration.

`robots.txt` and `sitemap.xml` are route handlers rather than Next's
`robots.ts` and `sitemap.ts` metadata routes for the same reason: a metadata
route is answered `public, max-age=0, must-revalidate` with no CDN policy
beside it, whatever it declares, so the edge revalidates it against the worker
on every request.

## To add or change a page

Three files decide what is published and in what order, and a page needs a line
in each:

- `app/content/product-docs.ts` — an explicit `?raw` import per document plus a
  row in the `documents` table giving its route slug and its repository path. A
  `docs/*.md` file that is not listed here is not published at all; links to it
  fall through to GitHub.
- `app/navigation.ts` — `NAVIGATION` is the publication catalogue: sections in
  order, items in order within them. Everything else derives from it.
  `NAVIGATION_ITEMS` flattens it, `/llms.txt` and `app/sitemap.xml/route.ts` walk it, previous/next
  pagination stays inside one `cluster`, and `generateStaticParams` in
  `app/(docs)/docs/[slug]/page.tsx` builds only slugs that `NAVIGATION` lists —
  so a document added to `product-docs.ts` alone renders nowhere. The sidebar
  shows direct entry routes and every secondary page in the selected section,
  on both the section's entry page and its articles. `DOCUMENTATION_INDEXES` selects the
  existing entries for Theory, Reference, Comparisons and case studies, and
  All pages. Index entries use a catalogue caption when a meaningful name
  needs context, and otherwise use the document's opening description.
- `app/content/markdown-links.ts` — `siteHref` maps a repository path to a site
  route. `docs/<name>.md` becomes `/docs/<name>` by default; add a row to
  `DOCUMENT_ROUTES` only when the route does not follow from the file name (as
  `start-cli` → `/start/cli` does not).

Package reference pages work the same way through
`app/content/package-docs.ts`, which imports `../packages/*/README.md` and is
the list `/reference/packages` renders.

`/llms.txt` is generated by the route handler in `app/llms.txt/route.ts`. Every
shipped README links it, so it opens with what an agent needs first: the
install, the skills the CLI ships and how to link them, the agent workflows,
the integrations, the source, and the example repositories listed in
`app/content/examples.ts`. The catalogue after that takes its sections and link
labels from `NAVIGATION`, and each entry's lead from the Markdown itself — the
lead paragraph, read by `app/content/markdown-text.ts`. Nothing in the catalogue
is written by hand, so a page that is in `NAVIGATION` is in `/llms.txt`.

An optional diagram above a document comes from `app/components/DocumentFigure.tsx`,
keyed by the same slug; a document with no entry there simply renders without one.
