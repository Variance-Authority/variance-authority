---
'@variance-authority/route-collector': minor
'@variance-authority/cli': minor
---

A page can leave a route run by saying so

A sitemap lists pages you do not review as pixels, such as long articles that
change with every prose edit. Put `data-variance-exclude="<reason>"` on any
element of such a page, or on the layout every article shares, and the route
collector navigates to it, reads and photographs nothing, and the run lists it
as `excluded` with that reason. An excluded page never sends a run to review.
A collector answers this with `{ ok: false, excluded: true, because }`.
