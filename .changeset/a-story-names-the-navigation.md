---
'@variance-authority/sense': minor
---

A page's story names the navigation that loaded each document after the first

Where a page went to another document of the same origin, or reloaded itself, during a case, its story now says so on the step it happened during, before what the new document ran: `page navigated http://shop.test/checkout`, or `page navigated http://reloading.test/ (reload)` where the browser reports a reload. The address is the one the top document was loaded at, without its query or fragment. A navigation to another origin carries no tape across, so it is not named. A `PageStory` carries the address as `url`, and `reload` where the browser says so; a frame carries neither.
