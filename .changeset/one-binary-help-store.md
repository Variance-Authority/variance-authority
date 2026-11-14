---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/package': minor
'@variance-authority/cli': minor
---

The questions `variance index` publishes are one binary store

`variance index` and every question that publishes a generation now write one
file beside the source index, `source-index.bin.help.bin`, in place of the JSON
value `source-index.bin.help.json` and the search `source-index.bin.help-search.bin`
beside it. `ask symbol`, `uses`, `search`, `packages`, `entrypoint`, `gaps`, the
help server and `variance serve` open it in place and decode a name only when a
question reads it. A generation published before this release is not read: the
next question reads the checkout and publishes the store, and `--just-answer`
refuses until `variance index` runs.

A store that is there and does not open is named with the answer, as
`The published value at … did not open (…); the checkout was read instead.`
There is no longer a second file to fall back on, so the counts a search shows
then are the checkout's, not the counts by published path.

Breaking for code that reads the files itself. `@variance-authority/sense` drops
`encodeSearch`, `exportedDigest`, `EncodedSearch`, `PublishedRows` and
`SearchGeneration`, and exports `encodeHelpStore`, `restampHelpStore` and the
`HelpStore`, `StoreMeta` and `EncodedStore` shapes. `HelpReading.publish` takes
`packagesDigest`, and its usage no longer carries the imports by path, which
the addon writes. `@variance-authority/help` exports `publishedHead`, the
generation read off the store's head alone, and its `StoreHead`; an `Unopened`
is always `published: 'value'`. A package's
`Documented` in `@variance-authority/package/help` no longer carries `declared`:
whether the manifests moved is compared by the digest the store keeps.
