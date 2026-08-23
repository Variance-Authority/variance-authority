# site

The public landing page, a [vinext](https://vinext.dev/) app deployed to
Cloudflare Workers. It is a project of its own — its own lockfile, outside the
repository's workspaces — so it installs and deploys without touching the
packages it describes.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # vinext build
yarn deploy      # wrangler login first; deploys to Cloudflare
```

Copy quotes the repository's own docs; the palette and mark follow
[docs/visual-guidelines.md](../docs/visual-guidelines.md). Like every page
here, it is written from one second after release: install lines are plain and
nothing hedges on publication status.
