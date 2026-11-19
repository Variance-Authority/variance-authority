---
'@variance-authority/sense': minor
---

A page's story names the navigation that loaded each document after the first

Where a page went to another document, or reloaded itself, during a case, its story now says so on the step it happened during, before what the new document ran: `page navigated http://shop.test/checkout`, or `page navigated http://reloading.test/ (reload)` where the address stayed the same. The address drops its query and fragment. A `PageStory` carries the document's address as `url`, absent where the realm has no location; a document with none names no navigation.
