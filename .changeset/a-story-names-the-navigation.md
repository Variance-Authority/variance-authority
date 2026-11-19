---
'@variance-authority/sense': minor
'@variance-authority/core': minor
---

A page's story names the navigation that loaded each document after the first

Where a page went to another document of the same origin, or reloaded itself, during a case, its story now says so on the step it happened during, before what the new document ran: `page navigated http://shop.test/checkout`, or `page reloaded http://reloading.test/` where the browser reports a reload. `navigationNote` in `@variance-authority/core/format` writes that note, for any runner that names a page's navigation. The address is the one the top document was loaded at, without its query or fragment. A navigation to another origin carries no tape across, so it is not named. A `PageStory` carries the address as `url`, and `reload` where the browser says so; a frame carries neither.
