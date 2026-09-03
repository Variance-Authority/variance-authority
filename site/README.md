# site

The public product and documentation site, a [vinext](https://vinext.dev/) app
deployed to Cloudflare Workers. It is a project of its own — its own lockfile,
outside the repository's workspaces — so it installs and deploys without
touching the packages it describes.

The build requires Node 22 or newer. `/` is the browser-facing presentation
route. Technical truth stays in `../docs` and the package READMEs; `/docs`,
`/start`, `/agents`, and `/reference` import that Markdown at build time and add
navigation and figures without creating another contract.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # vinext build
yarn deploy      # wrangler login first; deploys to Cloudflare
```
