---
'@variance-authority/playwright': minor
---

A prefetch never leaves the page

`observeNetwork` refuses a request the page sends on speculation: one marked
`Sec-Purpose: prefetch` or `Purpose: prefetch`, as `<link rel="prefetch">` and
speculation rules send it, or `Next-Router-Prefetch: 1`, as the Next.js App
Router and routers reproducing it send for every link in view. What the page
guesses it shows next is not what it shows. Served, a prefetch renders another
page's code under this page's journey, and when it is sent depends on what
scrolled into view.
