---
'@variance-authority/route-collector': patch
---

The site root's baseline is filed as `index`

A route collector run with a `directory` or `lfs` baseline store stopped at the
site's root page: its id is `/`, a baseline path is rendered from the subject's
name, and `/` has no letter or digit to render, so the store refused it on the
first run over any site. The root page now keeps the id `/` and names its
baseline file `index`, as a server names that page — `index-chromium.png` under
the default `{title}/{name}-{engine}`, and `index-375-chromium.png` at a declared
width of 375. Every other route is filed by its id, as before.
