# site

The public landing page, a [vinext](https://vinext.dev/) app deployed to
Cloudflare Workers. It is a workspace of its own — npm, not the repository's
yarn — so it installs and deploys without touching the packages it describes.

```bash
npm install
npm run dev      # vinext dev server
npm run build    # vinext build
npm run deploy   # wrangler login first; deploys to Cloudflare
```

Copy quotes the repository's own docs; the palette and mark follow
[docs/visual-guidelines.md](../docs/visual-guidelines.md). The page carries no
install line because no package is on a registry yet — when the first release
lands under the `beta` dist-tag, add one.
