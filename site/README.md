# site

The public documentation site, a [vinext](https://vinext.dev/) app deployed to
Cloudflare Workers. It is a project of its own — its own lockfile, outside the
repository's workspaces — so it installs and deploys without touching the
packages it describes.

The build requires Node 22 or newer. Product stories stay in `../docs` and the
package READMEs; the site imports that Markdown at build time and adds routing,
navigation, and figures without creating a second copy of the contract.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # vinext build
yarn deploy      # wrangler login first; deploys to Cloudflare
```
