# site

The public product and documentation site, a [vinext](https://vinext.dev/) app
deployed to Cloudflare Workers. It is a project of its own — its own lockfile,
outside the repository's workspaces — so it installs and deploys without
touching the packages it describes.

The build requires Node 22 or newer. `/` is the browser-facing presentation
route. Technical truth stays in `../docs` and the package READMEs; `/docs`,
`/start`, `/agents`, and `/reference` import that Markdown at build time and add
navigation and figures without creating another contract.

Every documented page also serves that Markdown beside it, at `<path>/index.md`,
with repository links repointed at the Markdown of the page they name.
`/llms.txt` indexes those in the reading order the sidebar uses, so a reader that
takes Markdown reaches the same material in the same order as a reader that takes
pages. Each page names the index in its head as `rel="describedby"` and its own
Markdown as `rel="alternate"`, and every response — page, `robots.txt`, Markdown
— names the index again in a `Link:` header, so a reader that fetches a URL
without rendering it is told where the source starts.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # vinext build
yarn deploy      # wrangler login first; deploys to Cloudflare
```
