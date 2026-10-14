---
'@variance-authority/route-collector': minor
---

The site root, `/`, is filed as `index`. Its id has no segment to name a baseline file after, so the default `baselines.path` refused it with "has no letter or digit in its {name}", and a sitemap or built directory with a home page could not be run. The id stays `/`, which is what `--subjects` and `variance accept` take.

With `widths` declared, the root was filed by its width alone, as `1280-chromium.png`, and is now `index-1280-chromium.png`. The next run reports the root as `new` and names the old file as a baseline the plan no longer holds: accept the new one and delete the old. A sitemap listing both `/` and `/index` now places both at one path, and the run refuses it by name.
