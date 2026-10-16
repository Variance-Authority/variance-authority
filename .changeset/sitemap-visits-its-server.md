---
'@variance-authority/route-collector': minor
---

A sitemap's pages are visited on the server the sitemap was read from. A site writes its sitemap for where it is published, so `sitemap: 'http://localhost:8787/sitemap.xml'` used to photograph production; each entry now keeps its path and query and takes the sitemap's origin. `routesFrom(xml, sitemap)` takes the sitemap's URL for the same reason.
