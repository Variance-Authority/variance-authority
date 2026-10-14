---
'@variance-authority/route-collector': patch
---

The site root, `/`, is filed as `index`. Its id has no segment to name a baseline file after, so the default `baselines.path` refused it with "has no letter or digit in its {name}"; a sitemap or built directory with a home page could not be run. The id stays `/`, which is what `--subjects` and `variance accept` take.
